// Package bootstrap creates the intentional pilot users and coach/athlete
// relationships recorded in a reviewed input manifest
// (docs/deployment-architecture-v0.2.md §10). It is deliberately separate
// from schema migration: bootstrap never creates or alters tables, and
// migrate never creates business rows.
//
// The manifest is reviewed, non-secret input: approved Firebase UIDs,
// names, and intended roles, not passwords, ID tokens, or service-account
// material. ManifestFromReader rejects any unrecognized field so a
// manifest that tries to smuggle in something like a password is refused
// at load time rather than silently ignored.
package bootstrap

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// User is one pilot account to create or update.
type User struct {
	FirebaseUID string `json:"firebaseUid"`
	Name        string `json:"name"`
	Role        string `json:"role"`
}

// Relationship is one approved coach/athlete connection.
type Relationship struct {
	CoachFirebaseUID   string `json:"coachFirebaseUid"`
	AthleteFirebaseUID string `json:"athleteFirebaseUid"`
}

// Manifest is the reviewed, non-secret bootstrap input (§10 step 2).
type Manifest struct {
	Users         []User         `json:"users"`
	Relationships []Relationship `json:"relationships"`
}

// LoadManifest reads and validates a manifest file. See ManifestFromReader
// for validation rules.
func LoadManifest(path string) (Manifest, error) {
	f, err := os.Open(path)
	if err != nil {
		return Manifest{}, fmt.Errorf("bootstrap: open manifest: %w", err)
	}
	defer f.Close()
	return ManifestFromReader(f)
}

// ManifestFromReader decodes and validates a manifest. It rejects:
//   - any field not in the User/Relationship shape above (DisallowUnknownFields),
//     so a manifest cannot carry a password/token/credential field unnoticed;
//   - a user with a blank firebaseUid or name, or a role other than
//     COACH/ATHLETE;
//   - a relationship referencing a firebaseUid not declared in Users, or
//     pairing a coach/athlete role incorrectly;
//   - a duplicate firebaseUid across Users.
func ManifestFromReader(r io.Reader) (Manifest, error) {
	dec := json.NewDecoder(r)
	dec.DisallowUnknownFields()

	var m Manifest
	if err := dec.Decode(&m); err != nil {
		return Manifest{}, fmt.Errorf("bootstrap: parse manifest: %w", err)
	}

	rolesByUID := make(map[string]string, len(m.Users))
	for i, u := range m.Users {
		if u.FirebaseUID == "" {
			return Manifest{}, fmt.Errorf("bootstrap: users[%d]: firebaseUid is required", i)
		}
		if u.Name == "" {
			return Manifest{}, fmt.Errorf("bootstrap: users[%d]: name is required", i)
		}
		if u.Role != "COACH" && u.Role != "ATHLETE" {
			return Manifest{}, fmt.Errorf("bootstrap: users[%d]: role must be COACH or ATHLETE, got %q", i, u.Role)
		}
		if _, dup := rolesByUID[u.FirebaseUID]; dup {
			return Manifest{}, fmt.Errorf("bootstrap: users[%d]: duplicate firebaseUid %q", i, u.FirebaseUID)
		}
		rolesByUID[u.FirebaseUID] = u.Role
	}

	for i, rel := range m.Relationships {
		coachRole, ok := rolesByUID[rel.CoachFirebaseUID]
		if !ok {
			return Manifest{}, fmt.Errorf("bootstrap: relationships[%d]: coachFirebaseUid %q is not declared in users", i, rel.CoachFirebaseUID)
		}
		if coachRole != "COACH" {
			return Manifest{}, fmt.Errorf("bootstrap: relationships[%d]: coachFirebaseUid %q is not a COACH", i, rel.CoachFirebaseUID)
		}
		athleteRole, ok := rolesByUID[rel.AthleteFirebaseUID]
		if !ok {
			return Manifest{}, fmt.Errorf("bootstrap: relationships[%d]: athleteFirebaseUid %q is not declared in users", i, rel.AthleteFirebaseUID)
		}
		if athleteRole != "ATHLETE" {
			return Manifest{}, fmt.Errorf("bootstrap: relationships[%d]: athleteFirebaseUid %q is not an ATHLETE", i, rel.AthleteFirebaseUID)
		}
	}

	return m, nil
}

// Result summarizes what Apply changed, for the bootstrap command's log
// output.
type Result struct {
	UsersUpserted        int
	RelationshipsCreated int
}

// Apply idempotently creates or updates the users and coach_athletes rows
// described by the manifest (§10 step 3). Re-running Apply with the same
// manifest is a no-op beyond re-affirming names/roles: user upsert keys on
// firebase_uid, and relationships are inserted with ON CONFLICT DO NOTHING.
func Apply(ctx context.Context, pool *pgxpool.Pool, m Manifest) (Result, error) {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return Result{}, fmt.Errorf("bootstrap: begin: %w", err)
	}
	defer tx.Rollback(ctx)

	var result Result
	now := time.Now().UTC()

	for _, u := range m.Users {
		tag, err := tx.Exec(ctx, `
			INSERT INTO users (id, firebase_uid, name, role, created_at)
			VALUES ($1, $2, $3, $4, $5)
			ON CONFLICT (firebase_uid) DO UPDATE
				SET name = EXCLUDED.name, role = EXCLUDED.role`,
			uuid.NewString(), u.FirebaseUID, u.Name, u.Role, now,
		)
		if err != nil {
			return Result{}, fmt.Errorf("bootstrap: upsert user %q: %w", u.FirebaseUID, err)
		}
		result.UsersUpserted += int(tag.RowsAffected())
	}

	for _, rel := range m.Relationships {
		tag, err := tx.Exec(ctx, `
			INSERT INTO coach_athletes (coach_id, athlete_id)
			SELECT coach.id, athlete.id
			FROM users coach, users athlete
			WHERE coach.firebase_uid = $1 AND athlete.firebase_uid = $2
			ON CONFLICT DO NOTHING`,
			rel.CoachFirebaseUID, rel.AthleteFirebaseUID,
		)
		if err != nil {
			return Result{}, fmt.Errorf("bootstrap: link coach %q to athlete %q: %w", rel.CoachFirebaseUID, rel.AthleteFirebaseUID, err)
		}
		result.RelationshipsCreated += int(tag.RowsAffected())
	}

	if err := tx.Commit(ctx); err != nil {
		return Result{}, fmt.Errorf("bootstrap: commit: %w", err)
	}

	return result, nil
}

// ErrEmptyManifest signals a manifest with no users, almost certainly a
// mistake rather than an intentional no-op bootstrap run.
var ErrEmptyManifest = errors.New("bootstrap: manifest has no users")
