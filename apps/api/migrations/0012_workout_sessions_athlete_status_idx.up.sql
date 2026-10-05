-- Serves GET /training-log and the LAST/PR history on GET /sessions/{id}
-- (docs/tasks/2026-10-04-training-history.md, sub-task 4): both look up one
-- athlete's sessions by status. EXPLAIN on seeded data showed sequential
-- scans of workout_sessions; set_logs is already indexed by session_id (the
-- leading column of its UNIQUE constraint).
CREATE INDEX workout_sessions_athlete_status_idx
    ON workout_sessions (athlete_id, status);
