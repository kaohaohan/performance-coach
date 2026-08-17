package bootstrap_test

import (
	"strings"
	"testing"

	"github.com/kaohaohan/performance-coach/apps/api/internal/bootstrap"
)

func TestManifestFromReaderAcceptsValidManifest(t *testing.T) {
	m, err := bootstrap.ManifestFromReader(strings.NewReader(`{
		"users": [
			{"firebaseUid": "coach-1", "name": "Coach One", "role": "COACH"},
			{"firebaseUid": "athlete-1", "name": "Athlete One", "role": "ATHLETE"}
		],
		"relationships": [
			{"coachFirebaseUid": "coach-1", "athleteFirebaseUid": "athlete-1"}
		]
	}`))
	if err != nil {
		t.Fatalf("ManifestFromReader() = %v, want nil", err)
	}
	if len(m.Users) != 2 || len(m.Relationships) != 1 {
		t.Fatalf("decoded manifest = %#v", m)
	}
}

func TestManifestFromReaderRejectsUnknownField(t *testing.T) {
	_, err := bootstrap.ManifestFromReader(strings.NewReader(`{
		"users": [
			{"firebaseUid": "coach-1", "name": "Coach One", "role": "COACH", "password": "leaked"}
		]
	}`))
	if err == nil {
		t.Fatal("ManifestFromReader() with an unrecognized field unexpectedly succeeded")
	}
}

func TestManifestFromReaderRejectsInvalidRole(t *testing.T) {
	_, err := bootstrap.ManifestFromReader(strings.NewReader(`{
		"users": [{"firebaseUid": "u1", "name": "A", "role": "ADMIN"}]
	}`))
	if err == nil {
		t.Fatal("ManifestFromReader() with an invalid role unexpectedly succeeded")
	}
}

func TestManifestFromReaderRejectsUndeclaredRelationshipUID(t *testing.T) {
	_, err := bootstrap.ManifestFromReader(strings.NewReader(`{
		"users": [{"firebaseUid": "coach-1", "name": "Coach One", "role": "COACH"}],
		"relationships": [{"coachFirebaseUid": "coach-1", "athleteFirebaseUid": "ghost"}]
	}`))
	if err == nil {
		t.Fatal("ManifestFromReader() with an undeclared relationship UID unexpectedly succeeded")
	}
}

func TestManifestFromReaderRejectsSwappedRelationshipRoles(t *testing.T) {
	_, err := bootstrap.ManifestFromReader(strings.NewReader(`{
		"users": [
			{"firebaseUid": "coach-1", "name": "Coach One", "role": "COACH"},
			{"firebaseUid": "athlete-1", "name": "Athlete One", "role": "ATHLETE"}
		],
		"relationships": [{"coachFirebaseUid": "athlete-1", "athleteFirebaseUid": "coach-1"}]
	}`))
	if err == nil {
		t.Fatal("ManifestFromReader() with swapped coach/athlete roles unexpectedly succeeded")
	}
}

func TestManifestFromReaderRejectsDuplicateFirebaseUID(t *testing.T) {
	_, err := bootstrap.ManifestFromReader(strings.NewReader(`{
		"users": [
			{"firebaseUid": "u1", "name": "A", "role": "COACH"},
			{"firebaseUid": "u1", "name": "B", "role": "ATHLETE"}
		]
	}`))
	if err == nil {
		t.Fatal("ManifestFromReader() with a duplicate firebaseUid unexpectedly succeeded")
	}
}
