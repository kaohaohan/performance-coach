-- Reverses 0001_init_schema.up.sql. Drops in reverse FK dependency order.
-- Indexes are dropped automatically with their owning table.

DROP TABLE IF EXISTS set_logs;
DROP TABLE IF EXISTS workout_sessions;
DROP TABLE IF EXISTS scheduled_workout_exercises;
DROP TABLE IF EXISTS scheduled_workouts;
DROP TABLE IF EXISTS workout_exercises;
DROP TABLE IF EXISTS workouts;
DROP TABLE IF EXISTS exercises;
DROP TABLE IF EXISTS coach_athletes;
DROP TABLE IF EXISTS users;
