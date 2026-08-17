package db

import "testing"

func TestAssertSafeSSLMode(t *testing.T) {
	cases := []struct {
		name    string
		dsn     string
		wantErr bool
	}{
		{
			name: "loopback with sslmode disable is safe",
			dsn:  "postgres://performance:performance@localhost:5433/performance_coach?sslmode=disable",
		},
		{
			name: "loopback IP with sslmode disable is safe",
			dsn:  "postgres://performance:performance@127.0.0.1:5433/performance_coach?sslmode=disable",
		},
		{
			name: "cloud sql socket with sslmode disable is safe",
			dsn:  "postgres://appuser:secret@/performance_coach?host=/cloudsql/proj:asia-east1:pilot&sslmode=disable",
		},
		{
			name:    "public host with sslmode disable is refused",
			dsn:     "postgres://appuser:secret@db.example.com:5432/performance_coach?sslmode=disable",
			wantErr: true,
		},
		{
			name: "public host without sslmode is unaffected",
			dsn:  "postgres://appuser:secret@db.example.com:5432/performance_coach",
		},
		{
			name: "public host with sslmode require is unaffected",
			dsn:  "postgres://appuser:secret@db.example.com:5432/performance_coach?sslmode=require",
		},
		{
			name:    "unparsable DSN is refused",
			dsn:     "://not a url",
			wantErr: true,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := AssertSafeSSLMode(tc.dsn)
			if tc.wantErr && err == nil {
				t.Fatalf("AssertSafeSSLMode(%q) = nil, want error", tc.dsn)
			}
			if !tc.wantErr && err != nil {
				t.Fatalf("AssertSafeSSLMode(%q) = %v, want nil", tc.dsn, err)
			}
		})
	}
}
