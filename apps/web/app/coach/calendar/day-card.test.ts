import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import DayCard from "./day-card.tsx";

test("renders a separate status for every assignment and no S/R footer", () => {
  const markup = renderToStaticMarkup(React.createElement(DayCard, {
    date: "2026-08-24",
    selectedDate: "2026-08-24",
    monthAnchor: "2026-08-01",
    density: "week",
    assignments: [
      { id: "not-started", scheduledDate: "2026-08-24", athlete: { id: "athlete", name: "Athlete" }, workout: { id: "one", name: "Strength" }, session: null },
      { id: "active", scheduledDate: "2026-08-24", athlete: { id: "athlete", name: "Athlete" }, workout: { id: "two", name: "Conditioning" }, session: { id: "session", status: "ACTIVE" as const } },
      { id: "completed", scheduledDate: "2026-08-24", athlete: { id: "athlete", name: "Athlete" }, workout: { id: "three", name: "Mobility" }, session: { id: "done", status: "COMPLETED" as const } },
    ],
    workoutsById: new Map(),
    disabled: false,
    onSelect: () => {},
    onAddWorkout: () => {},
  }));

  assert.equal((markup.match(/Not started/g) ?? []).length, 1);
  assert.equal((markup.match(/In progress/g) ?? []).length, 1);
  assert.equal((markup.match(/Done/g) ?? []).length, 1);
  assert.doesNotMatch(markup, />S <span/);
  assert.doesNotMatch(markup, />R <span/);
});
