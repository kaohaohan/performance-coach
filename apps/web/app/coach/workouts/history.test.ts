import assert from "node:assert/strict";
import test from "node:test";
import {
  groupHistory,
  historyDateRange,
  historyEndpoint,
  historyStatusLabel,
  prepareHistory,
  type HistoryEntry,
} from "./history.ts";

const today = new Date(2026, 7, 27, 12);

function entry(id: string, scheduledDate: string, athleteName: string, status: "ACTIVE" | "COMPLETED" | null = null): HistoryEntry {
  return {
    id,
    scheduledDate,
    athlete: { id: `athlete-${athleteName}`, name: athleteName },
    workout: { id: `workout-${id}`, name: `Workout ${id}` },
    session: status === null ? null : { id: `session-${id}`, status },
  };
}

test("builds inclusive local date ranges ending today", () => {
  assert.deepEqual(historyDateRange("7", today), { from: "2026-08-21", to: "2026-08-27" });
  assert.deepEqual(historyDateRange("30", today), { from: "2026-07-29", to: "2026-08-27" });
  assert.deepEqual(historyDateRange("90", today), { from: "2026-05-30", to: "2026-08-27" });
  assert.deepEqual(historyDateRange("all", today), { from: "0001-01-01", to: "2026-08-27" });
});

test("builds all-athlete and encoded individual-athlete endpoints", () => {
  assert.equal(historyEndpoint("30", today, ""), "/api/v1/scheduled-workouts?from=2026-07-29&to=2026-08-27");
  assert.equal(historyEndpoint("7", today, "athlete id"), "/api/v1/scheduled-workouts?from=2026-08-21&to=2026-08-27&athleteId=athlete+id");
});

test("excludes future assignments and sorts each athlete assignment newest first", () => {
  const prepared = prepareHistory([
    entry("older", "2026-08-26", "Peter Pan"),
    entry("future", "2026-08-28", "Peter Pan"),
    entry("newer-b", "2026-08-27", "薛若照", "COMPLETED"),
    entry("newer-a", "2026-08-27", "Peter Pan", "ACTIVE"),
  ], today);

  assert.deepEqual(prepared.map((item) => item.id), ["newer-a", "newer-b", "older"]);
});

test("groups adjacent prepared entries by date without merging athletes", () => {
  const groups = groupHistory(prepareHistory([
    entry("peter", "2026-08-27", "Peter Pan"),
    entry("hsueh", "2026-08-27", "薛若照", "COMPLETED"),
    entry("older", "2026-08-26", "Peter Pan"),
  ], today));

  assert.deepEqual(groups.map((group) => [group.date, group.entries.map((item) => item.id)]), [
    ["2026-08-27", ["peter", "hsueh"]],
    ["2026-08-26", ["older"]],
  ]);
});

test("uses the Calendar status language", () => {
  assert.equal(historyStatusLabel(null), "Not started");
  assert.equal(historyStatusLabel({ id: "active", status: "ACTIVE" }), "In progress");
  assert.equal(historyStatusLabel({ id: "done", status: "COMPLETED" }), "Done");
});
