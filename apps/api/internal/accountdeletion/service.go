package accountdeletion

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/kaohaohan/performance-coach/apps/api/internal/authn"
	"github.com/kaohaohan/performance-coach/apps/api/internal/logging"
)

const (
	statusPendingExternal = "PENDING_EXTERNAL"
	statusComplete        = "COMPLETE"
	recentAuthWindow      = 5 * time.Minute
	tombstoneCoach        = "Deleted Coach"
	tombstoneAthlete      = "Deleted Athlete"
)

// ErrRecentAuthRequired is mapped to 403 RECENT_AUTH_REQUIRED.
var ErrRecentAuthRequired = errors.New("accountdeletion: recent authentication is required")

// InvalidArgumentError is mapped to 400 INVALID_ARGUMENT. Message must never
// include authorization codes, refresh tokens, or Apple client secrets.
type InvalidArgumentError struct {
	Message string
}

func (e *InvalidArgumentError) Error() string {
	if e == nil || e.Message == "" {
		return "accountdeletion: invalid argument"
	}
	return e.Message
}

// Service implements DELETE /api/v1/me: recent-auth, Apple bind, tombstone
// + prune, durable job, and best-effort Firebase/Apple cleanup.
type Service struct {
	pool     *pgxpool.Pool
	apple    AppleClient
	firebase authn.UserDeleter
	now      func() time.Time
}

// New constructs a Service. apple may be nil when Sign in with Apple REST
// credentials are not configured; Apple-linked first deletions then fail
// closed with an internal error. now may be nil (defaults to time.Now).
func New(pool *pgxpool.Pool, apple AppleClient, firebase authn.UserDeleter, now func() time.Time) *Service {
	if now == nil {
		now = time.Now
	}
	return &Service{pool: pool, apple: apple, firebase: firebase, now: now}
}

// DeleteMe tombstones the authenticated application user and drives
// external cleanup. Failures before DB commit are returned to the handler.
// Failures after commit are persisted on the job and still succeed here
// so the handler returns 204.
func (s *Service) DeleteMe(ctx context.Context, caller authn.User, appleAuthorizationCode *string) error {
	if err := s.requireRecentAuth(caller); err != nil {
		return err
	}
	if err := validateAppleCodePresence(caller, appleAuthorizationCode); err != nil {
		return err
	}

	alreadyDeleted := caller.DeletedAt != nil
	appleLinked := len(caller.AppleProviderUIDs) > 0

	var exchanged *AppleTokens
	if appleLinked && !alreadyDeleted {
		if s.apple == nil {
			return fmt.Errorf("accountdeletion: apple token client is not configured")
		}
		tokens, err := s.apple.ExchangeAuthorizationCode(ctx, *appleAuthorizationCode)
		if err != nil {
			return mapAppleExchangeError(err)
		}
		if tokens.RefreshToken == "" || !appleSubBound(caller.AppleProviderUIDs, tokens.Subject) {
			return &InvalidArgumentError{Message: "appleAuthorizationCode is invalid"}
		}
		exchanged = &tokens
	}

	if err := s.commitDeletion(ctx, caller, exchanged); err != nil {
		return err
	}
	s.completeExternalCleanup(ctx, caller.ID)
	return nil
}

// SweepPending is best-effort recovery of PENDING_EXTERNAL jobs. It is not
// a guaranteed scheduler. Errors are logged per job and do not fail boot.
func (s *Service) SweepPending(ctx context.Context) error {
	rows, err := s.pool.Query(ctx, `SELECT user_id FROM account_deletion_jobs WHERE status = $1`, statusPendingExternal)
	if err != nil {
		return err
	}
	defer rows.Close()

	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return err
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		return err
	}

	for _, id := range ids {
		s.completeExternalCleanup(ctx, id)
	}
	return nil
}

func (s *Service) requireRecentAuth(caller authn.User) error {
	if caller.AuthTime.IsZero() {
		return ErrRecentAuthRequired
	}
	if s.now().UTC().Sub(caller.AuthTime.UTC()) > recentAuthWindow {
		return ErrRecentAuthRequired
	}
	return nil
}

func validateAppleCodePresence(caller authn.User, code *string) error {
	if code != nil && strings.TrimSpace(*code) == "" {
		return &InvalidArgumentError{Message: "appleAuthorizationCode must not be empty"}
	}
	appleLinked := len(caller.AppleProviderUIDs) > 0
	supplied := code != nil
	if !appleLinked && supplied {
		return &InvalidArgumentError{Message: "appleAuthorizationCode must be omitted when Apple is not linked"}
	}
	if appleLinked && caller.DeletedAt == nil && !supplied {
		return &InvalidArgumentError{Message: "appleAuthorizationCode is required"}
	}
	return nil
}

func appleSubBound(providerUIDs []string, sub string) bool {
	if sub == "" {
		return false
	}
	for _, uid := range providerUIDs {
		if uid == sub {
			return true
		}
	}
	return false
}

func mapAppleExchangeError(err error) error {
	var inv *InvalidArgumentError
	if errors.As(err, &inv) {
		return inv
	}
	return err
}

func (s *Service) commitDeletion(ctx context.Context, caller authn.User, appleTokens *AppleTokens) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("accountdeletion: begin: %w", err)
	}
	defer tx.Rollback(ctx)

	var (
		role      string
		deletedAt *time.Time
		firebase  string
	)
	err = tx.QueryRow(ctx,
		`SELECT role, deleted_at, firebase_uid FROM users WHERE id = $1 FOR UPDATE`,
		caller.ID,
	).Scan(&role, &deletedAt, &firebase)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("accountdeletion: user disappeared during deletion")
		}
		return fmt.Errorf("accountdeletion: lock user: %w", err)
	}

	if deletedAt == nil {
		name := tombstoneAthlete
		if role == "COACH" {
			name = tombstoneCoach
		}
		if _, err := tx.Exec(ctx,
			`UPDATE users SET name = $2, deleted_at = now() WHERE id = $1 AND deleted_at IS NULL`,
			caller.ID, name,
		); err != nil {
			return fmt.Errorf("accountdeletion: tombstone user: %w", err)
		}
		if err := pruneOwnedData(ctx, tx, caller.ID); err != nil {
			return err
		}

		var refresh any
		var appleRevoked any
		if appleTokens != nil {
			refresh = appleTokens.RefreshToken
			appleRevoked = nil
		} else {
			refresh = nil
			appleRevoked = time.Now()
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO account_deletion_jobs (
				user_id, original_firebase_uid, apple_refresh_token,
				firebase_deleted_at, apple_revoked_at, status, last_error,
				created_at, updated_at
			) VALUES ($1, $2, $3, NULL, $4, $5, NULL, now(), now())
			ON CONFLICT (user_id) DO NOTHING
		`, caller.ID, firebase, refresh, appleRevoked, statusPendingExternal); err != nil {
			return fmt.Errorf("accountdeletion: insert job: %w", err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("accountdeletion: commit: %w", err)
	}
	return nil
}

func pruneOwnedData(ctx context.Context, tx pgx.Tx, userID string) error {
	if _, err := tx.Exec(ctx, `DELETE FROM coach_invite_codes WHERE coach_id = $1`, userID); err != nil {
		return fmt.Errorf("accountdeletion: prune invite codes: %w", err)
	}

	const unstarted = `
		SELECT sw.id
		FROM scheduled_workouts sw
		WHERE (sw.coach_id = $1 OR sw.athlete_id = $1)
		  AND NOT EXISTS (
		      SELECT 1 FROM workout_sessions ws WHERE ws.scheduled_workout_id = sw.id
		  )`

	if _, err := tx.Exec(ctx, `
		DELETE FROM scheduled_workout_planned_sets
		WHERE scheduled_workout_exercise_id IN (
			SELECT swe.id
			FROM scheduled_workout_exercises swe
			WHERE swe.scheduled_workout_id IN (`+unstarted+`)
		)`, userID); err != nil {
		return fmt.Errorf("accountdeletion: prune planned sets: %w", err)
	}
	if _, err := tx.Exec(ctx, `
		DELETE FROM scheduled_workout_exercises
		WHERE scheduled_workout_id IN (`+unstarted+`)`, userID); err != nil {
		return fmt.Errorf("accountdeletion: prune scheduled exercises: %w", err)
	}
	if _, err := tx.Exec(ctx, `
		DELETE FROM scheduled_workouts
		WHERE id IN (`+unstarted+`)`, userID); err != nil {
		return fmt.Errorf("accountdeletion: prune unstarted scheduled workouts: %w", err)
	}

	if _, err := tx.Exec(ctx, `
		DELETE FROM workout_exercise_set_overrides
		WHERE workout_exercise_id IN (
			SELECT we.id FROM workout_exercises we
			JOIN workouts w ON w.id = we.workout_id
			WHERE w.coach_id = $1
		)`, userID); err != nil {
		return fmt.Errorf("accountdeletion: prune template overrides: %w", err)
	}
	if _, err := tx.Exec(ctx, `
		DELETE FROM workout_exercises
		WHERE workout_id IN (SELECT id FROM workouts WHERE coach_id = $1)`, userID); err != nil {
		return fmt.Errorf("accountdeletion: prune template exercises: %w", err)
	}
	if _, err := tx.Exec(ctx, `
		DELETE FROM workouts
		WHERE coach_id = $1
		  AND NOT EXISTS (
		      SELECT 1 FROM scheduled_workouts sw WHERE sw.workout_id = workouts.id
		  )`, userID); err != nil {
		return fmt.Errorf("accountdeletion: prune unreferenced workouts: %w", err)
	}
	if _, err := tx.Exec(ctx, `
		DELETE FROM exercises
		WHERE owner_coach_id = $1
		  AND NOT EXISTS (
		      SELECT 1 FROM scheduled_workout_exercises swe WHERE swe.exercise_id = exercises.id
		  )
		  AND NOT EXISTS (
		      SELECT 1 FROM workout_exercises we WHERE we.exercise_id = exercises.id
		  )`, userID); err != nil {
		return fmt.Errorf("accountdeletion: prune unreferenced private exercises: %w", err)
	}
	return nil
}

type deletionJob struct {
	UserID              string
	OriginalFirebaseUID string
	AppleRefreshToken   *string
	FirebaseDeletedAt   *time.Time
	AppleRevokedAt      *time.Time
	Status              string
}

func (s *Service) completeExternalCleanup(ctx context.Context, userID string) {
	logger := logging.FromContext(ctx)
	job, err := s.loadJob(ctx, userID)
	if err != nil {
		logger.Error("account deletion load job", "user_id", userID, "error", err.Error())
		return
	}
	if job.Status == statusComplete {
		return
	}

	secrets := []string{}
	if job.AppleRefreshToken != nil {
		secrets = append(secrets, *job.AppleRefreshToken)
	}

	if job.AppleRevokedAt == nil {
		if job.AppleRefreshToken == nil || *job.AppleRefreshToken == "" {
			if err := s.markAppleRevoked(ctx, userID); err != nil {
				logger.Error("account deletion mark apple n/a", "user_id", userID, "error", err.Error())
				return
			}
		} else {
			if s.apple == nil {
				s.persistLastError(ctx, userID, "apple token client is not configured", secrets)
				return
			}
			if err := s.apple.RevokeRefreshToken(ctx, *job.AppleRefreshToken); err != nil {
				s.persistLastError(ctx, userID, redactSecrets(err.Error(), secrets...), secrets)
				// Continue to Firebase so login identity can still be removed.
			} else if err := s.markAppleRevoked(ctx, userID); err != nil {
				logger.Error("account deletion mark apple revoked", "user_id", userID, "error", err.Error())
				return
			} else {
				job.AppleRevokedAt = ptrTime(s.now())
				job.AppleRefreshToken = nil
			}
		}
	}

	if job.FirebaseDeletedAt == nil {
		if s.firebase == nil {
			s.persistLastError(ctx, userID, "firebase deleter is not configured", secrets)
			return
		}
		if err := s.firebase.DeleteUser(ctx, job.OriginalFirebaseUID); err != nil {
			s.persistLastError(ctx, userID, redactSecrets(err.Error(), secrets...), secrets)
			return
		}
		if err := s.markFirebaseDeleted(ctx, userID); err != nil {
			logger.Error("account deletion mark firebase deleted", "user_id", userID, "error", err.Error())
			return
		}
		job.FirebaseDeletedAt = ptrTime(s.now())
	}

	reloaded, err := s.loadJob(ctx, userID)
	if err != nil {
		logger.Error("account deletion reload job", "user_id", userID, "error", err.Error())
		return
	}
	if reloaded.AppleRevokedAt == nil || reloaded.FirebaseDeletedAt == nil {
		return
	}
	if err := s.markComplete(ctx, userID); err != nil {
		logger.Error("account deletion mark complete", "user_id", userID, "error", err.Error())
	}
}

func (s *Service) loadJob(ctx context.Context, userID string) (deletionJob, error) {
	var job deletionJob
	err := s.pool.QueryRow(ctx, `
		SELECT user_id, original_firebase_uid, apple_refresh_token,
		       firebase_deleted_at, apple_revoked_at, status
		FROM account_deletion_jobs
		WHERE user_id = $1
	`, userID).Scan(
		&job.UserID, &job.OriginalFirebaseUID, &job.AppleRefreshToken,
		&job.FirebaseDeletedAt, &job.AppleRevokedAt, &job.Status,
	)
	if err != nil {
		return deletionJob{}, err
	}
	return job, nil
}

func (s *Service) markAppleRevoked(ctx context.Context, userID string) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE account_deletion_jobs
		SET apple_revoked_at = now(),
		    apple_refresh_token = NULL,
		    updated_at = now()
		WHERE user_id = $1 AND status = $2
	`, userID, statusPendingExternal)
	return err
}

func (s *Service) markFirebaseDeleted(ctx context.Context, userID string) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE account_deletion_jobs
		SET firebase_deleted_at = now(),
		    updated_at = now()
		WHERE user_id = $1 AND status = $2
	`, userID, statusPendingExternal)
	return err
}

func (s *Service) markComplete(ctx context.Context, userID string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var status string
	if err := tx.QueryRow(ctx, `
		SELECT status
		FROM account_deletion_jobs
		WHERE user_id = $1 AND status = $2
		FOR UPDATE
	`, userID, statusPendingExternal).Scan(&status); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		return err
	}

	deletedUID := "deleted:" + userID
	if _, err := tx.Exec(ctx, `
		UPDATE users SET firebase_uid = $2 WHERE id = $1
	`, userID, deletedUID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
		UPDATE account_deletion_jobs
		SET status = $2,
		    original_firebase_uid = $3,
		    apple_refresh_token = NULL,
		    last_error = NULL,
		    updated_at = now()
		WHERE user_id = $1
	`, userID, statusComplete, deletedUID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *Service) persistLastError(ctx context.Context, userID, message string, secrets []string) {
	msg := redactSecrets(message, secrets...)
	if len(msg) > 500 {
		msg = msg[:500]
	}
	if _, err := s.pool.Exec(ctx, `
		UPDATE account_deletion_jobs
		SET last_error = $2, updated_at = now()
		WHERE user_id = $1 AND status = $3
	`, userID, msg, statusPendingExternal); err != nil {
		logging.FromContext(ctx).Error("account deletion persist last_error", "user_id", userID, "error", err.Error())
	}
}

func redactSecrets(msg string, secrets ...string) string {
	for _, secret := range secrets {
		if secret == "" {
			continue
		}
		msg = strings.ReplaceAll(msg, secret, "[redacted]")
	}
	return msg
}

func ptrTime(t time.Time) *time.Time {
	return &t
}
