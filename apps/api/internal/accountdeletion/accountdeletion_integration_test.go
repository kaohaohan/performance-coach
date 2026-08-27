package accountdeletion_test

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/kaohaohan/performance-coach/apps/api/internal/accountdeletion"
	"github.com/kaohaohan/performance-coach/apps/api/internal/authn"
	"github.com/kaohaohan/performance-coach/apps/api/internal/invitecode"
	"github.com/kaohaohan/performance-coach/apps/api/internal/prescription"
	"github.com/kaohaohan/performance-coach/apps/api/internal/scheduledworkout"
	"github.com/kaohaohan/performance-coach/apps/api/internal/workout"
	"github.com/kaohaohan/performance-coach/apps/api/internal/workoutsession"
)

var (
	testPool   *pgxpool.Pool
	skipReason string
	testPrefix = "accountdeletion-integration-" + uuid.NewString()
)

func TestMain(m *testing.M) {
	url := strings.TrimSpace(os.Getenv("TEST_DATABASE_URL"))
	if url == "" {
		skipReason = "TEST_DATABASE_URL is not set"
		os.Exit(m.Run())
	}
	if !strings.Contains(url, "/performance_coach_test") {
		skipReason = "TEST_DATABASE_URL must target performance_coach_test"
		os.Exit(m.Run())
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		skipReason = "cannot connect to TEST_DATABASE_URL"
		os.Exit(m.Run())
	}
	testPool = pool
	code := m.Run()
	cleanup(context.Background())
	pool.Close()
	os.Exit(code)
}

func TestCoachDeleteMeLifecycle(t *testing.T) {
	requireDB(t)
	ctx := context.Background()
	coach := createUser(t, "COACH")
	athlete := createUser(t, "ATHLETE")
	connect(t, coach, athlete)
	otherCoach := createUser(t, "COACH")
	otherDesc := testPrefix + " other-invite"
	if _, err := invitecode.Create(ctx, testPool, otherCoach, invitecode.CreateInput{Description: &otherDesc}); err != nil {
		t.Fatal(err)
	}

	desc := testPrefix + " invite"
	if _, err := invitecode.Create(ctx, testPool, coach, invitecode.CreateInput{Description: &desc}); err != nil {
		t.Fatal(err)
	}

	kept := createWorkout(t, coach, testPrefix+" kept")
	unused := createWorkout(t, coach, testPrefix+" unused")
	started, err := scheduledworkout.Create(ctx, testPool, coach, scheduledworkout.CreateInput{
		WorkoutID: kept.ID, AthleteIDs: []string{athlete.ID}, ScheduledDate: "2026-08-20",
	})
	if err != nil {
		t.Fatal(err)
	}
	unstarted, err := scheduledworkout.Create(ctx, testPool, coach, scheduledworkout.CreateInput{
		WorkoutID: kept.ID, AthleteIDs: []string{athlete.ID}, ScheduledDate: "2026-08-21",
	})
	if err != nil {
		t.Fatal(err)
	}
	session, _, err := workoutsession.Start(ctx, testPool, athlete, started[0].ID)
	if err != nil {
		t.Fatal(err)
	}
	setLog := createSetLog(t, athlete, session.ID, started[0])
	keptExerciseID := kept.Exercises[0].ExerciseID
	unusedExerciseID := unused.Exercises[0].ExerciseID

	fb := &fakeFirebase{}
	rec := deleteMe(t, coach, nil, fb, "")
	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d body = %s", rec.Code, rec.Body.String())
	}
	if strings.Contains(rec.Body.String(), "refresh") || strings.Contains(strings.ToLower(rec.Body.String()), "token") && rec.Body.Len() > 0 {
		t.Fatalf("response leaked secret-like text: %s", rec.Body.String())
	}

	assertUser(t, coach.ID, "Deleted Coach", true, "deleted:"+coach.ID)
	job := loadJob(t, coach.ID)
	if job.Status != "COMPLETE" || job.OriginalUID != "deleted:"+coach.ID {
		t.Fatalf("job = %#v, want original_firebase_uid scrubbed", job)
	}
	if job.Refresh != nil {
		t.Fatal("apple_refresh_token must be cleared for non-Apple completion")
	}
	if job.LastError != nil {
		t.Fatalf("last_error must be cleared on COMPLETE, got %#v", job.LastError)
	}
	if job.AppleRevokedAt == nil || job.FirebaseDeletedAt == nil {
		t.Fatalf("external timestamps missing: %#v", job)
	}
	if len(fb.calls) != 1 || fb.calls[0] != coach.FirebaseUID {
		t.Fatalf("firebase deletes = %v", fb.calls)
	}

	var inviteCount int
	if err := testPool.QueryRow(ctx, `SELECT count(*) FROM coach_invite_codes WHERE coach_id = $1`, coach.ID).Scan(&inviteCount); err != nil {
		t.Fatal(err)
	}
	if inviteCount != 0 {
		t.Fatalf("invite codes remaining = %d", inviteCount)
	}
	var otherInvites int
	if err := testPool.QueryRow(ctx, `SELECT count(*) FROM coach_invite_codes WHERE coach_id = $1`, otherCoach.ID).Scan(&otherInvites); err != nil {
		t.Fatal(err)
	}
	if otherInvites != 1 {
		t.Fatal("other coach invite must be untouched")
	}

	assertExists(t, `SELECT count(*) FROM scheduled_workouts WHERE id = $1`, started[0].ID, 1)
	assertExists(t, `SELECT count(*) FROM workout_sessions WHERE id = $1 AND status = 'ACTIVE'`, session.ID, 1)
	assertExists(t, `SELECT count(*) FROM set_logs WHERE id = $1`, setLog.ID, 1)
	assertExists(t, `SELECT count(*) FROM workouts WHERE id = $1`, kept.ID, 1)
	assertExists(t, `SELECT count(*) FROM exercises WHERE id = $1`, keptExerciseID, 1)
	assertExists(t, `SELECT count(*) FROM scheduled_workouts WHERE id = $1`, unstarted[0].ID, 0)
	assertExists(t, `SELECT count(*) FROM workouts WHERE id = $1`, unused.ID, 0)
	assertExists(t, `SELECT count(*) FROM exercises WHERE id = $1`, unusedExerciseID, 0)
	assertExists(t, `SELECT count(*) FROM coach_athletes WHERE coach_id = $1 AND athlete_id = $2`, coach.ID, athlete.ID, 1)

	getRec := getMe(t, coach)
	if getRec.Code != http.StatusUnauthorized {
		t.Fatalf("GET /me after tombstone status = %d, want 401", getRec.Code)
	}

	retry := deleteMe(t, coach, nil, fb, "")
	if retry.Code != http.StatusUnauthorized {
		t.Fatalf("COMPLETE retry status = %d body = %s, want 401", retry.Code, retry.Body.String())
	}
}

func TestAthleteDeleteMeLifecycle(t *testing.T) {
	requireDB(t)
	ctx := context.Background()
	coach := createUser(t, "COACH")
	athlete := createUser(t, "ATHLETE")
	connect(t, coach, athlete)
	w := createWorkout(t, coach, testPrefix+" athlete-lifecycle")
	started, err := scheduledworkout.Create(ctx, testPool, coach, scheduledworkout.CreateInput{
		WorkoutID: w.ID, AthleteIDs: []string{athlete.ID}, ScheduledDate: "2026-08-22",
	})
	if err != nil {
		t.Fatal(err)
	}
	unstarted, err := scheduledworkout.Create(ctx, testPool, coach, scheduledworkout.CreateInput{
		WorkoutID: w.ID, AthleteIDs: []string{athlete.ID}, ScheduledDate: "2026-08-23",
	})
	if err != nil {
		t.Fatal(err)
	}
	session, _, err := workoutsession.Start(ctx, testPool, athlete, started[0].ID)
	if err != nil {
		t.Fatal(err)
	}
	setLog := createSetLog(t, athlete, session.ID, started[0])
	libraryWorkout := createWorkout(t, coach, testPrefix+" coach-library-untouched")
	libraryExerciseID := libraryWorkout.Exercises[0].ExerciseID

	fb := &fakeFirebase{}
	rec := deleteMe(t, athlete, nil, fb, "{}")
	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d body = %s", rec.Code, rec.Body.String())
	}

	assertUser(t, athlete.ID, "Deleted Athlete", true, "deleted:"+athlete.ID)
	job := loadJob(t, athlete.ID)
	if job.Status != "COMPLETE" || job.OriginalUID != "deleted:"+athlete.ID {
		t.Fatalf("job = %#v, want original_firebase_uid scrubbed", job)
	}

	assertExists(t, `SELECT count(*) FROM scheduled_workouts WHERE id = $1`, started[0].ID, 1)
	assertExists(t, `SELECT count(*) FROM workout_sessions WHERE id = $1 AND status = 'ACTIVE'`, session.ID, 1)
	assertExists(t, `SELECT count(*) FROM set_logs WHERE id = $1`, setLog.ID, 1)
	assertExists(t, `SELECT count(*) FROM workouts WHERE id = $1`, w.ID, 1)
	assertExists(t, `SELECT count(*) FROM exercises WHERE id = $1`, w.Exercises[0].ExerciseID, 1)
	assertExists(t, `SELECT count(*) FROM scheduled_workouts WHERE id = $1`, unstarted[0].ID, 0)
	assertExists(t, `SELECT count(*) FROM workouts WHERE id = $1`, libraryWorkout.ID, 1)
	assertExists(t, `SELECT count(*) FROM exercises WHERE id = $1`, libraryExerciseID, 1)
	assertExists(t, `SELECT count(*) FROM coach_athletes WHERE coach_id = $1 AND athlete_id = $2`, coach.ID, athlete.ID, 1)

	var sessionStatus string
	if err := testPool.QueryRow(ctx, `SELECT status FROM workout_sessions WHERE id = $1`, session.ID).Scan(&sessionStatus); err != nil {
		t.Fatal(err)
	}
	if sessionStatus != "ACTIVE" {
		t.Fatalf("athlete session status = %q, want ACTIVE (must not fabricate COMPLETED)", sessionStatus)
	}
}

func TestDeleteMeRejectsStaleAuthTime(t *testing.T) {
	requireDB(t)
	coach := createUser(t, "COACH")
	fb := &fakeFirebase{}
	rec := deleteMeAt(t, coach, nil, fb, "", time.Now().UTC().Add(-6*time.Minute), nil)
	assertErrorEnvelope(t, rec, http.StatusForbidden, "RECENT_AUTH_REQUIRED")
	assertUser(t, coach.ID, coach.Name, false, coach.FirebaseUID)
	assertExists(t, `SELECT count(*) FROM account_deletion_jobs WHERE user_id = $1`, coach.ID, 0)
}

func TestDeleteMeRejectsMalformedAndUnknownJSON(t *testing.T) {
	requireDB(t)
	coach := createUser(t, "COACH")
	fb := &fakeFirebase{}
	for _, body := range []string{`{`, `{"unexpected":true}`, `null`} {
		rec := deleteMe(t, coach, nil, fb, body)
		assertErrorEnvelope(t, rec, http.StatusBadRequest, "INVALID_ARGUMENT")
	}
	assertUser(t, coach.ID, coach.Name, false, coach.FirebaseUID)
}

func TestDeleteMeAppleLinkedMissingCode(t *testing.T) {
	requireDB(t)
	coach := createUser(t, "COACH")
	apple := &fakeApple{subject: "apple-sub-1", refresh: "refresh-secret-value"}
	rec := deleteMeAt(t, coach, apple, &fakeFirebase{}, "", time.Now().UTC(), []string{"apple-sub-1"})
	assertErrorEnvelope(t, rec, http.StatusBadRequest, "INVALID_ARGUMENT")
	if len(apple.exchanges) != 0 {
		t.Fatal("must not contact Apple when code is missing")
	}
	assertExists(t, `SELECT count(*) FROM account_deletion_jobs WHERE user_id = $1`, coach.ID, 0)
}

func TestDeleteMeNonAppleRejectsSuppliedCode(t *testing.T) {
	requireDB(t)
	coach := createUser(t, "COACH")
	rec := deleteMe(t, coach, nil, &fakeFirebase{}, `{"appleAuthorizationCode":"abc"}`)
	assertErrorEnvelope(t, rec, http.StatusBadRequest, "INVALID_ARGUMENT")
	assertExists(t, `SELECT count(*) FROM account_deletion_jobs WHERE user_id = $1`, coach.ID, 0)
}

func TestDeleteMeInvalidAppleAuthorizationCode(t *testing.T) {
	requireDB(t)
	coach := createUser(t, "COACH")
	apple := &fakeApple{exchangeErr: &accountdeletion.InvalidArgumentError{Message: "appleAuthorizationCode is invalid"}}
	rec := deleteMeAt(t, coach, apple, &fakeFirebase{}, `{"appleAuthorizationCode":"bad"}`, time.Now().UTC(), []string{"apple-sub-1"})
	assertErrorEnvelope(t, rec, http.StatusBadRequest, "INVALID_ARGUMENT")
	if rec.Body.String() != "" && strings.Contains(rec.Body.String(), "bad") {
		t.Fatalf("error leaked authorization code: %s", rec.Body.String())
	}
	assertExists(t, `SELECT count(*) FROM account_deletion_jobs WHERE user_id = $1`, coach.ID, 0)
	assertUser(t, coach.ID, coach.Name, false, coach.FirebaseUID)
}

func TestDeleteMeAppleSubMismatchDoesNotMutate(t *testing.T) {
	requireDB(t)
	coach := createUser(t, "COACH")
	apple := &fakeApple{subject: "other-apple-user", refresh: "refresh-secret-value"}
	rec := deleteMeAt(t, coach, apple, &fakeFirebase{}, `{"appleAuthorizationCode":"valid-for-someone-else"}`, time.Now().UTC(), []string{"expected-apple-sub"})
	assertErrorEnvelope(t, rec, http.StatusBadRequest, "INVALID_ARGUMENT")
	if apple.revokes != 0 {
		t.Fatal("must not revoke a refresh token bound to a different Apple sub")
	}
	assertExists(t, `SELECT count(*) FROM account_deletion_jobs WHERE user_id = $1`, coach.ID, 0)
	assertUser(t, coach.ID, coach.Name, false, coach.FirebaseUID)
	if strings.Contains(rec.Body.String(), "refresh-secret-value") {
		t.Fatal("response leaked refresh token")
	}
}

func TestDeleteMeAppleRevokeFailureKeepsPendingJob(t *testing.T) {
	requireDB(t)
	coach := createUser(t, "COACH")
	apple := &fakeApple{subject: "apple-sub-1", refresh: "refresh-secret-value", revokeErr: errors.New("revoke failed for refresh-secret-value")}
	fb := &fakeFirebase{}
	rec := deleteMeAt(t, coach, apple, fb, `{"appleAuthorizationCode":"ok"}`, time.Now().UTC(), []string{"apple-sub-1"})
	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d body = %s", rec.Code, rec.Body.String())
	}
	if strings.Contains(rec.Body.String(), "refresh-secret-value") {
		t.Fatal("204 body leaked refresh token")
	}
	assertUser(t, coach.ID, "Deleted Coach", true, coach.FirebaseUID)
	job := loadJob(t, coach.ID)
	if job.Status != "PENDING_EXTERNAL" {
		t.Fatalf("status = %s", job.Status)
	}
	if job.Refresh == nil || *job.Refresh != "refresh-secret-value" {
		t.Fatal("refresh token must be retained until revoke succeeds")
	}
	if job.AppleRevokedAt != nil {
		t.Fatal("apple_revoked_at must stay null on revoke failure")
	}
	if job.FirebaseDeletedAt == nil {
		t.Fatal("firebase cleanup should still proceed after apple revoke failure")
	}
	if job.LastError == nil || strings.Contains(*job.LastError, "refresh-secret-value") {
		t.Fatalf("last_error must be present and redacted, got %#v", job.LastError)
	}

	apple.revokeErr = nil
	retry := deleteMeAt(t, coach, apple, fb, "", time.Now().UTC(), []string{"apple-sub-1"})
	if retry.Code != http.StatusNoContent {
		t.Fatalf("retry status = %d body = %s", retry.Code, retry.Body.String())
	}
	job = loadJob(t, coach.ID)
	if job.Status != "COMPLETE" || job.Refresh != nil || job.AppleRevokedAt == nil || job.OriginalUID != "deleted:"+coach.ID || job.LastError != nil {
		t.Fatalf("retry job = %#v", job)
	}
	assertUser(t, coach.ID, "Deleted Coach", true, "deleted:"+coach.ID)
}

func TestDeleteMeFirebaseFailureThenRetryAndUserNotFound(t *testing.T) {
	requireDB(t)
	coach := createUser(t, "COACH")
	fb := &fakeFirebase{err: errors.New("firebase down")}
	rec := deleteMe(t, coach, nil, fb, "")
	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d body = %s", rec.Code, rec.Body.String())
	}
	assertUser(t, coach.ID, "Deleted Coach", true, coach.FirebaseUID)
	job := loadJob(t, coach.ID)
	if job.Status != "PENDING_EXTERNAL" || job.FirebaseDeletedAt != nil {
		t.Fatalf("job after firebase failure = %#v", job)
	}
	if job.OriginalUID != coach.FirebaseUID {
		t.Fatal("original firebase uid must be retained until cleanup succeeds")
	}

	fb.err = nil
	retry := deleteMe(t, coach, nil, fb, "")
	if retry.Code != http.StatusNoContent {
		t.Fatalf("retry status = %d", retry.Code)
	}
	assertUser(t, coach.ID, "Deleted Coach", true, "deleted:"+coach.ID)
	job = loadJob(t, coach.ID)
	if job.Status != "COMPLETE" || job.OriginalUID != "deleted:"+coach.ID || job.LastError != nil {
		t.Fatalf("complete job = %#v", job)
	}

	athlete := createUser(t, "ATHLETE")
	gone := &fakeFirebase{} // production maps user-not-found to nil
	rec = deleteMe(t, athlete, nil, gone, "")
	if rec.Code != http.StatusNoContent {
		t.Fatalf("user-not-found status = %d", rec.Code)
	}
	assertUser(t, athlete.ID, "Deleted Athlete", true, "deleted:"+athlete.ID)
}

func TestDeleteMeSweepPendingExternal(t *testing.T) {
	requireDB(t)
	coach := createUser(t, "COACH")
	fb := &fakeFirebase{err: errors.New("firebase down")}
	if rec := deleteMe(t, coach, nil, fb, ""); rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d", rec.Code)
	}
	fb.err = nil
	svc := accountdeletion.New(testPool, nil, fb, time.Now)
	if err := svc.SweepPending(context.Background()); err != nil {
		t.Fatal(err)
	}
	assertUser(t, coach.ID, "Deleted Coach", true, "deleted:"+coach.ID)
	job := loadJob(t, coach.ID)
	if job.Status != "COMPLETE" || job.OriginalUID != "deleted:"+coach.ID {
		t.Fatal("sweep should complete pending job and scrub original firebase uid")
	}
}

func TestPreDeletionTokenCannotRestoreApplicationAccess(t *testing.T) {
	requireDB(t)
	coach := createUser(t, "COACH")
	originalUID := coach.FirebaseUID
	fb := &fakeFirebase{err: errors.New("firebase down")}
	if rec := deleteMe(t, coach, nil, fb, ""); rec.Code != http.StatusNoContent {
		t.Fatalf("first delete status = %d body = %s", rec.Code, rec.Body.String())
	}
	if loadJob(t, coach.ID).Status != "PENDING_EXTERNAL" {
		t.Fatal("want PENDING_EXTERNAL so the pre-deletion token still maps via original uid")
	}

	verifier := staticVerifier{token: authn.VerifiedToken{
		UID:      originalUID,
		AuthTime: time.Now().UTC(),
	}}
	ordinary := authn.Middleware(verifier, testPool)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("ordinary application-user handler must not run for a tombstoned user")
		w.WriteHeader(http.StatusOK)
	}))
	req := httptest.NewRequest(http.MethodGet, "/api/v1/me", nil)
	req.Header.Set("Authorization", "Bearer pre-deletion-id-token")
	ordinaryRec := httptest.NewRecorder()
	ordinary.ServeHTTP(ordinaryRec, req)
	if ordinaryRec.Code != http.StatusUnauthorized {
		t.Fatalf("ordinary middleware status = %d, want 401 (pre-deletion token must not restore GET /me)", ordinaryRec.Code)
	}

	pendingRetry := deleteMe(t, coach, nil, fb, "")
	if pendingRetry.Code != http.StatusNoContent {
		t.Fatalf("PENDING_EXTERNAL DELETE /me status = %d, want 204", pendingRetry.Code)
	}

	fb.err = nil
	if rec := deleteMe(t, coach, nil, fb, ""); rec.Code != http.StatusNoContent {
		t.Fatalf("cleanup retry status = %d", rec.Code)
	}
	if loadJob(t, coach.ID).OriginalUID != "deleted:"+coach.ID {
		t.Fatal("COMPLETE must scrub original_firebase_uid")
	}

	completeOrdinary := httptest.NewRecorder()
	ordinary.ServeHTTP(completeOrdinary, req)
	if completeOrdinary.Code != http.StatusUnauthorized {
		t.Fatalf("ordinary middleware after COMPLETE = %d, want 401", completeOrdinary.Code)
	}
	completeDelete := deleteMe(t, coach, nil, fb, "")
	if completeDelete.Code != http.StatusUnauthorized {
		t.Fatalf("DELETE /me after COMPLETE = %d body = %s, want 401", completeDelete.Code, completeDelete.Body.String())
	}
}

func createSetLog(t *testing.T, athlete authn.User, sessionID string, created scheduledworkout.Created) workoutsession.SetLog {
	t.Helper()
	exercise := created.Exercises[0]
	reps := 5
	log, err := workoutsession.CreateSetLog(context.Background(), testPool, athlete, sessionID, workoutsession.CreateSetLogInput{
		Kind:                         "PLANNED",
		ScheduledWorkoutExerciseID:   exercise.ScheduledWorkoutExerciseID,
		ScheduledWorkoutPlannedSetID: &exercise.Plan.Sets[0].ScheduledWorkoutPlannedSetID,
		Reps:                         &reps,
	})
	if err != nil {
		t.Fatal(err)
	}
	return log
}

type fakeApple struct {
	mu          sync.Mutex
	subject     string
	refresh     string
	exchangeErr error
	revokeErr   error
	exchanges   []string
	revokes     int
}

func (f *fakeApple) ExchangeAuthorizationCode(ctx context.Context, code string) (accountdeletion.AppleTokens, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.exchanges = append(f.exchanges, code)
	if f.exchangeErr != nil {
		return accountdeletion.AppleTokens{}, f.exchangeErr
	}
	return accountdeletion.AppleTokens{RefreshToken: f.refresh, Subject: f.subject}, nil
}

func (f *fakeApple) RevokeRefreshToken(ctx context.Context, refreshToken string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.revokes++
	return f.revokeErr
}

type fakeFirebase struct {
	mu    sync.Mutex
	err   error
	calls []string
}

func (f *fakeFirebase) DeleteUser(ctx context.Context, uid string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls = append(f.calls, uid)
	return f.err
}

type staticVerifier struct {
	token authn.VerifiedToken
}

func (s staticVerifier) VerifyIDToken(ctx context.Context, idToken string) (authn.VerifiedToken, error) {
	return s.token, nil
}

func deleteMe(t *testing.T, user authn.User, apple accountdeletion.AppleClient, fb *fakeFirebase, body string) *httptest.ResponseRecorder {
	t.Helper()
	return deleteMeAt(t, user, apple, fb, body, time.Now().UTC(), nil)
}

func deleteMeAt(t *testing.T, user authn.User, apple accountdeletion.AppleClient, fb *fakeFirebase, body string, authTime time.Time, appleUIDs []string) *httptest.ResponseRecorder {
	t.Helper()
	svc := accountdeletion.New(testPool, apple, fb, time.Now)
	handler := authn.TombstoneRetryMiddleware(staticVerifier{token: authn.VerifiedToken{
		UID:               user.FirebaseUID,
		AuthTime:          authTime,
		AppleProviderUIDs: appleUIDs,
	}}, testPool)(accountdeletion.HandleDelete(svc))

	var rdr io.Reader
	if body != "" {
		rdr = strings.NewReader(body)
	}
	req := httptest.NewRequest(http.MethodDelete, "/api/v1/me", rdr)
	req.Header.Set("Authorization", "Bearer test-token")
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	return rec
}

func getMe(t *testing.T, user authn.User) *httptest.ResponseRecorder {
	t.Helper()
	handler := authn.Middleware(staticVerifier{token: authn.VerifiedToken{
		UID:      user.FirebaseUID,
		AuthTime: time.Now().UTC(),
	}}, testPool)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	req := httptest.NewRequest(http.MethodGet, "/api/v1/me", nil)
	req.Header.Set("Authorization", "Bearer test-token")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	return rec
}

func createUser(t *testing.T, role string) authn.User {
	t.Helper()
	u := authn.User{
		ID:          uuid.NewString(),
		FirebaseUID: testPrefix + "-uid-" + uuid.NewString(),
		Name:        testPrefix + " " + role,
		Role:        role,
	}
	if _, err := testPool.Exec(context.Background(),
		`INSERT INTO users (id, firebase_uid, name, role, created_at) VALUES ($1, $2, $3, $4, now())`,
		u.ID, u.FirebaseUID, u.Name, u.Role,
	); err != nil {
		t.Fatal(err)
	}
	return u
}

func connect(t *testing.T, coach, athlete authn.User) {
	t.Helper()
	if _, err := testPool.Exec(context.Background(), `INSERT INTO coach_athletes (coach_id, athlete_id) VALUES ($1, $2)`, coach.ID, athlete.ID); err != nil {
		t.Fatal(err)
	}
}

func createWorkout(t *testing.T, coach authn.User, name string) workout.Workout {
	t.Helper()
	reps := 5
	created, err := workout.Create(context.Background(), testPool, coach, workout.CreateInput{
		Name: name,
		Exercises: []workout.CreateExerciseInput{{
			Name: name + " ex",
			Plan: prescription.Plan{SetCount: 1, Defaults: prescription.Defaults{Reps: &reps}},
		}},
	})
	if err != nil {
		t.Fatal(err)
	}
	return created
}

type jobSnapshot struct {
	OriginalUID       string
	Refresh           *string
	FirebaseDeletedAt *time.Time
	AppleRevokedAt    *time.Time
	Status            string
	LastError         *string
}

func loadJob(t *testing.T, userID string) jobSnapshot {
	t.Helper()
	var job jobSnapshot
	if err := testPool.QueryRow(context.Background(), `
		SELECT original_firebase_uid, apple_refresh_token, firebase_deleted_at, apple_revoked_at, status, last_error
		FROM account_deletion_jobs WHERE user_id = $1
	`, userID).Scan(&job.OriginalUID, &job.Refresh, &job.FirebaseDeletedAt, &job.AppleRevokedAt, &job.Status, &job.LastError); err != nil {
		t.Fatal(err)
	}
	return job
}

func assertUser(t *testing.T, id, wantName string, wantDeleted bool, wantFirebaseUID string) {
	t.Helper()
	var name, firebaseUID string
	var deletedAt *time.Time
	if err := testPool.QueryRow(context.Background(),
		`SELECT name, firebase_uid, deleted_at FROM users WHERE id = $1`, id,
	).Scan(&name, &firebaseUID, &deletedAt); err != nil {
		t.Fatal(err)
	}
	if name != wantName {
		t.Fatalf("name = %q, want %q", name, wantName)
	}
	if wantDeleted && deletedAt == nil {
		t.Fatal("deleted_at is null")
	}
	if !wantDeleted && deletedAt != nil {
		t.Fatal("deleted_at unexpectedly set")
	}
	if firebaseUID != wantFirebaseUID {
		t.Fatalf("firebase_uid = %q, want %q", firebaseUID, wantFirebaseUID)
	}
}

func assertExists(t *testing.T, query string, arg1 string, extraAndWant ...any) {
	t.Helper()
	args := []any{arg1}
	want := extraAndWant[len(extraAndWant)-1].(int)
	if len(extraAndWant) == 2 {
		args = append(args, extraAndWant[0])
	}
	var count int
	if err := testPool.QueryRow(context.Background(), query, args...).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != want {
		t.Fatalf("count = %d, want %d query = %s", count, want, query)
	}
}

func assertErrorEnvelope(t *testing.T, rec *httptest.ResponseRecorder, status int, code string) {
	t.Helper()
	if rec.Code != status {
		t.Fatalf("status = %d, want %d body = %s", rec.Code, status, rec.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("body %s: %v", rec.Body.String(), err)
	}
	errObj, _ := body["error"].(map[string]any)
	if errObj["code"] != code {
		t.Fatalf("error = %#v, want code %s", body, code)
	}
}

func requireDB(t *testing.T) {
	t.Helper()
	if skipReason != "" {
		t.Skip(skipReason)
	}
}

func cleanup(ctx context.Context) {
	if testPool == nil {
		return
	}
	pattern := testPrefix + "%"
	_, _ = testPool.Exec(ctx, `DELETE FROM set_logs WHERE session_id IN (
		SELECT ws.id FROM workout_sessions ws
		JOIN users u ON u.id = ws.athlete_id
		WHERE u.firebase_uid LIKE $1 OR u.id IN (SELECT user_id FROM account_deletion_jobs WHERE original_firebase_uid LIKE $1)
	)`, pattern)
	_, _ = testPool.Exec(ctx, `DELETE FROM workout_sessions WHERE athlete_id IN (
		SELECT id FROM users WHERE firebase_uid LIKE $1
		UNION SELECT user_id FROM account_deletion_jobs WHERE original_firebase_uid LIKE $1
	)`, pattern)
	_, _ = testPool.Exec(ctx, `DELETE FROM scheduled_workout_planned_sets WHERE scheduled_workout_exercise_id IN (
		SELECT swe.id FROM scheduled_workout_exercises swe
		JOIN scheduled_workouts sw ON sw.id = swe.scheduled_workout_id
		WHERE sw.coach_id IN (
			SELECT id FROM users WHERE firebase_uid LIKE $1
			UNION SELECT user_id FROM account_deletion_jobs WHERE original_firebase_uid LIKE $1
		)
	)`, pattern)
	_, _ = testPool.Exec(ctx, `DELETE FROM scheduled_workout_exercises WHERE scheduled_workout_id IN (
		SELECT id FROM scheduled_workouts WHERE coach_id IN (
			SELECT id FROM users WHERE firebase_uid LIKE $1
			UNION SELECT user_id FROM account_deletion_jobs WHERE original_firebase_uid LIKE $1
		) OR athlete_id IN (
			SELECT id FROM users WHERE firebase_uid LIKE $1
			UNION SELECT user_id FROM account_deletion_jobs WHERE original_firebase_uid LIKE $1
		)
	)`, pattern)
	_, _ = testPool.Exec(ctx, `DELETE FROM scheduled_workouts WHERE coach_id IN (
		SELECT id FROM users WHERE firebase_uid LIKE $1
		UNION SELECT user_id FROM account_deletion_jobs WHERE original_firebase_uid LIKE $1
	) OR athlete_id IN (
		SELECT id FROM users WHERE firebase_uid LIKE $1
		UNION SELECT user_id FROM account_deletion_jobs WHERE original_firebase_uid LIKE $1
	)`, pattern)
	_, _ = testPool.Exec(ctx, `DELETE FROM workout_exercise_set_overrides WHERE workout_exercise_id IN (
		SELECT we.id FROM workout_exercises we JOIN workouts w ON w.id = we.workout_id
		WHERE w.coach_id IN (
			SELECT id FROM users WHERE firebase_uid LIKE $1
			UNION SELECT user_id FROM account_deletion_jobs WHERE original_firebase_uid LIKE $1
		)
	)`, pattern)
	_, _ = testPool.Exec(ctx, `DELETE FROM workout_exercises WHERE workout_id IN (
		SELECT id FROM workouts WHERE coach_id IN (
			SELECT id FROM users WHERE firebase_uid LIKE $1
			UNION SELECT user_id FROM account_deletion_jobs WHERE original_firebase_uid LIKE $1
		)
	)`, pattern)
	_, _ = testPool.Exec(ctx, `DELETE FROM workouts WHERE coach_id IN (
		SELECT id FROM users WHERE firebase_uid LIKE $1
		UNION SELECT user_id FROM account_deletion_jobs WHERE original_firebase_uid LIKE $1
	)`, pattern)
	_, _ = testPool.Exec(ctx, `DELETE FROM exercises WHERE owner_coach_id IN (
		SELECT id FROM users WHERE firebase_uid LIKE $1
		UNION SELECT user_id FROM account_deletion_jobs WHERE original_firebase_uid LIKE $1
	)`, pattern)
	_, _ = testPool.Exec(ctx, `DELETE FROM coach_invite_codes WHERE coach_id IN (
		SELECT id FROM users WHERE firebase_uid LIKE $1
		UNION SELECT user_id FROM account_deletion_jobs WHERE original_firebase_uid LIKE $1
	)`, pattern)
	_, _ = testPool.Exec(ctx, `DELETE FROM coach_athletes WHERE coach_id IN (
		SELECT id FROM users WHERE firebase_uid LIKE $1
		UNION SELECT user_id FROM account_deletion_jobs WHERE original_firebase_uid LIKE $1
	) OR athlete_id IN (
		SELECT id FROM users WHERE firebase_uid LIKE $1
		UNION SELECT user_id FROM account_deletion_jobs WHERE original_firebase_uid LIKE $1
	)`, pattern)
	_, _ = testPool.Exec(ctx, `DELETE FROM account_deletion_jobs WHERE original_firebase_uid LIKE $1 OR user_id IN (SELECT id FROM users WHERE name LIKE $1)`, pattern)
	_, _ = testPool.Exec(ctx, `DELETE FROM users WHERE firebase_uid LIKE $1 OR firebase_uid LIKE 'deleted:%' AND id IN (
		SELECT id FROM users WHERE name LIKE $1
	)`, pattern)
	_, _ = testPool.Exec(ctx, `DELETE FROM users WHERE name LIKE $1`, pattern)
}
