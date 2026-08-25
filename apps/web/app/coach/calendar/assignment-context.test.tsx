// Regression coverage for the Athlete Calendar's assignment context: the
// athlete whose calendar the builder was opened from must be the assignment
// target, and must survive Save Draft, restore, reopen, and a reload —
// without ever leaking into a different athlete's builder.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const routerPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush, replace: vi.fn() }),
}));

vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ user: { uid: "coach-1" }, idToken: "id-token", loading: false }),
}));

const apiFetchMock = vi.fn();
vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return { ...actual, apiFetch: (...args: unknown[]) => apiFetchMock(...args) };
});

import CoachCalendarPage from "./page";

const ATHLETES = [
  { id: "athlete-hao", name: "Hao Han" },
  { id: "athlete-cheryl", name: "Cheryl Chao" },
  { id: "athlete-colin", name: "Colin" },
];

const EXERCISES = [
  { id: "ex-squat", name: "Back Squat", scope: "SYSTEM" },
  { id: "ex-bench", name: "Bench Press", scope: "SYSTEM" },
];

type ApiCall = { path: string; method: string; body: Record<string, unknown> | undefined };
let apiCalls: ApiCall[] = [];

function installApi() {
  apiCalls = [];
  apiFetchMock.mockImplementation(async (_token: string, path: string, options?: { method?: string; body?: Record<string, unknown> }) => {
    apiCalls.push({ path, method: options?.method ?? "GET", body: options?.body });
    if (path === "/api/v1/athletes") return ATHLETES;
    if (path === "/api/v1/workouts" && !options?.method) return [];
    if (path.startsWith("/api/v1/exercises")) return EXERCISES;
    if (path.startsWith("/api/v1/scheduled-workouts") && !options?.method) return [];
    if (path === "/api/v1/workouts" && options?.method === "POST") return { id: "workout-new", name: "New", exercises: [] };
    if (path === "/api/v1/scheduled-workouts" && options?.method === "POST") return {};
    throw new Error(`unexpected API call: ${options?.method ?? "GET"} ${path}`);
  });
}

function scheduleCalls(): ApiCall[] {
  return apiCalls.filter((call) => call.path === "/api/v1/scheduled-workouts" && call.method === "POST");
}

async function renderCalendar() {
  const view = render(<CoachCalendarPage />);
  await screen.findByRole("combobox");
  return view;
}

function athleteSelect(): HTMLSelectElement {
  return screen.getAllByRole("combobox")[0] as HTMLSelectElement;
}

// The ASSIGN TO checkbox for one athlete, by visible name.
function assignCheckbox(name: string): HTMLInputElement {
  const fieldset = screen.getByRole("group", { name: /assign to/i });
  return within(fieldset).getByLabelText(name) as HTMLInputElement;
}

function assignTargets(): string[] {
  const fieldset = screen.getByRole("group", { name: /assign to/i });
  return within(fieldset)
    .getAllByRole("checkbox")
    .filter((box) => (box as HTMLInputElement).checked)
    .map((box) => (box.closest("label") as HTMLLabelElement).textContent?.trim() ?? "");
}

function clickText(text: string | RegExp) {
  fireEvent.click(screen.getByRole("button", { name: text }));
}

// Opens the builder in Build mode with one valid exercise on it.
async function startBuildDraft() {
  clickText(/\+ Add Workout|Resume draft/);
  clickText(/Build New Workout/);
  clickText(/\+ Add Exercise/);
  const picker = await screen.findByRole("list");
  fireEvent.click(within(picker).getAllByRole("button", { name: "Add" })[0]);
  fireEvent.change(screen.getByLabelText("Sets"), { target: { value: "3" } });
  fireEvent.change(screen.getByLabelText("Reps"), { target: { value: "8" } });
}

function todayISO(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function storedDraft(): { sourceAthleteId: string; extraAthleteIds: string[]; scheduledDate: string } | null {
  const raw = window.localStorage.getItem("performance-coach:workout-builder-draft:coach-1");
  return raw === null ? null : JSON.parse(raw);
}

beforeEach(() => {
  installApi();
  window.localStorage.clear();
  routerPush.mockClear();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Athlete Calendar → Build New Workout assignment context", () => {
  it("Case A — pre-selects the current calendar athlete on a fresh workout", async () => {
    await renderCalendar();
    fireEvent.change(athleteSelect(), { target: { value: "athlete-hao" } });

    clickText(/\+ Add Workout|Resume draft/);
    clickText(/Build New Workout/);

    expect(assignTargets()).toEqual(["Hao Han"]);
    expect(assignCheckbox("Hao Han").checked).toBe(true);
  });

  it("Case A — Build & Assign succeeds with only the calendar athlete", async () => {
    await renderCalendar();
    fireEvent.change(athleteSelect(), { target: { value: "athlete-hao" } });
    await startBuildDraft();

    clickText(/^Build & Assign$/);
    await waitFor(() => expect(scheduleCalls()).toHaveLength(1));
    expect(scheduleCalls()[0].body?.athleteIds).toEqual(["athlete-hao"]);
    expect(screen.queryByText("Select at least one athlete.")).toBeNull();
  });

  it("Case B — Save Draft keeps the calendar athlete selected", async () => {
    await renderCalendar();
    fireEvent.change(athleteSelect(), { target: { value: "athlete-hao" } });
    await startBuildDraft();

    clickText(/^Save Draft$/);
    expect(assignTargets()).toEqual(["Hao Han"]);

    clickText(/^Build & Assign$/);
    await waitFor(() => expect(scheduleCalls()).toHaveLength(1));
    expect(scheduleCalls()[0].body?.athleteIds).toEqual(["athlete-hao"]);
  });

  it("Case B — closing and reopening the builder keeps the calendar athlete", async () => {
    await renderCalendar();
    fireEvent.change(athleteSelect(), { target: { value: "athlete-hao" } });
    await startBuildDraft();
    clickText(/^Save Draft$/);

    clickText(/^Close$/);
    clickText(/Resume draft/);

    expect(assignTargets()).toEqual(["Hao Han"]);
  });

  it("Case C — a draft restored after a reload still targets its own athlete", async () => {
    const first = await renderCalendar();
    fireEvent.change(athleteSelect(), { target: { value: "athlete-cheryl" } });
    await startBuildDraft();
    clickText(/^Save Draft$/);
    first.unmount();

    await renderCalendar();
    await screen.findByText(/Draft restored/);

    expect(assignTargets()).toEqual(["Cheryl Chao"]);
    clickText(/^Build & Assign$/);
    await waitFor(() => expect(scheduleCalls()).toHaveLength(1));
    expect(scheduleCalls()[0].body?.athleteIds).toEqual(["athlete-cheryl"]);
  });

  it("Case D — starting a new workout for another athlete does not leak the previous one", async () => {
    await renderCalendar();
    fireEvent.change(athleteSelect(), { target: { value: "athlete-hao" } });
    clickText(/\+ Add Workout|Resume draft/);
    clickText(/Build New Workout/);
    expect(assignTargets()).toEqual(["Hao Han"]);
    clickText(/^Close$/);

    fireEvent.change(athleteSelect(), { target: { value: "athlete-cheryl" } });
    clickText(/\+ Add Workout|Resume draft/);
    clickText(/Build New Workout/);

    expect(assignTargets()).toEqual(["Cheryl Chao"]);
  });

  it("Case F — additional athletes are assigned alongside the calendar athlete, once each", async () => {
    await renderCalendar();
    fireEvent.change(athleteSelect(), { target: { value: "athlete-hao" } });
    await startBuildDraft();

    fireEvent.click(assignCheckbox("Colin"));
    expect(assignTargets()).toEqual(["Hao Han", "Colin"]);

    clickText(/^Build & Assign$/);
    await waitFor(() => expect(scheduleCalls()).toHaveLength(1));
    expect(scheduleCalls()[0].body?.athleteIds).toEqual(["athlete-hao", "athlete-colin"]);
  });

  it("Case G — the calendar athlete cannot be deselected", async () => {
    await renderCalendar();
    fireEvent.change(athleteSelect(), { target: { value: "athlete-hao" } });
    await startBuildDraft();

    expect(assignCheckbox("Hao Han").disabled).toBe(true);
    fireEvent.click(assignCheckbox("Hao Han"));
    expect(assignTargets()).toEqual(["Hao Han"]);
  });

  it("Case H — a draft keeps its own athlete and date while the calendar browses elsewhere", async () => {
    await renderCalendar();
    fireEvent.change(athleteSelect(), { target: { value: "athlete-hao" } });
    await startBuildDraft();
    clickText(/^Save Draft$/);

    // Leaving the builder for another athlete is guarded; confirm it.
    fireEvent.change(athleteSelect(), { target: { value: "athlete-cheryl" } });
    fireEvent.click(await screen.findByRole("button", { name: "Switch athlete" }));

    clickText(/Resume draft/);
    expect(assignTargets()).toEqual(["Hao Han"]);

    clickText(/^Build & Assign$/);
    await waitFor(() => expect(scheduleCalls()).toHaveLength(1));
    expect(scheduleCalls()[0].body?.athleteIds).toEqual(["athlete-hao"]);
  });
  it("reported symptom — the builder can never end up with nothing to assign to", async () => {
    await renderCalendar();
    fireEvent.change(athleteSelect(), { target: { value: "athlete-hao" } });
    await startBuildDraft();

    // Uncheck everything the Coach is allowed to uncheck.
    const fieldset = screen.getByRole("group", { name: /assign to/i });
    for (const box of within(fieldset).getAllByRole("checkbox")) {
      const checkbox = box as HTMLInputElement;
      if (!checkbox.disabled && checkbox.checked) fireEvent.click(checkbox);
    }

    expect(assignTargets()).toEqual(["Hao Han"]);
    clickText(/^Build & Assign$/);
    await waitFor(() => expect(scheduleCalls()).toHaveLength(1));
    expect(scheduleCalls()[0].body?.athleteIds).toEqual(["athlete-hao"]);
    expect(screen.queryByText("Select at least one athlete.")).toBeNull();
  });

  it("Case E — a restored draft whose athlete is gone falls back to the calendar, not a stranger", async () => {
    window.localStorage.setItem("performance-coach:workout-builder-draft:coach-1", JSON.stringify({
      version: 2,
      savedAt: new Date().toISOString(),
      name: "Wednesday Lower",
      exercises: [],
      sourceAthleteId: "athlete-removed",
      extraAthleteIds: ["athlete-colin"],
      scheduledDate: todayISO(),
      editTarget: null,
    }));

    await renderCalendar();
    await screen.findByText(/Draft restored/);

    // The calendar's own athlete, and only that athlete — the stored extra is
    // never replayed.
    expect(assignTargets()).toEqual(["Hao Han"]);
  });

  it("autosave persists the draft's own athlete, not the calendar being browsed", async () => {
    await renderCalendar();
    fireEvent.change(athleteSelect(), { target: { value: "athlete-cheryl" } });
    await startBuildDraft();

    await waitFor(() => expect(storedDraft()).not.toBeNull(), { timeout: 3000 });
    expect(storedDraft()?.sourceAthleteId).toBe("athlete-cheryl");
    expect(storedDraft()?.extraAthleteIds).toEqual([]);
    expect(storedDraft()?.scheduledDate).toBe(todayISO());
  });

  it("Save Draft records the extra athletes the Coach added", async () => {
    await renderCalendar();
    fireEvent.change(athleteSelect(), { target: { value: "athlete-hao" } });
    await startBuildDraft();
    fireEvent.click(assignCheckbox("Colin"));

    clickText(/^Save Draft$/);
    expect(storedDraft()?.sourceAthleteId).toBe("athlete-hao");
    expect(storedDraft()?.extraAthleteIds).toEqual(["athlete-colin"]);
  });

  it("Build & Assign is guarded against a double submit", async () => {
    await renderCalendar();
    fireEvent.change(athleteSelect(), { target: { value: "athlete-hao" } });
    await startBuildDraft();

    const submit = screen.getByRole("button", { name: /^Build & Assign$/ });
    fireEvent.click(submit);
    fireEvent.click(submit);
    await waitFor(() => expect(scheduleCalls()).toHaveLength(1));
    expect(apiCalls.filter((call) => call.path === "/api/v1/workouts" && call.method === "POST")).toHaveLength(1);
  });

  it("clears the assignment context after a successful assign", async () => {
    await renderCalendar();
    fireEvent.change(athleteSelect(), { target: { value: "athlete-hao" } });
    await startBuildDraft();
    fireEvent.click(assignCheckbox("Colin"));

    clickText(/^Build & Assign$/);
    await waitFor(() => expect(scheduleCalls()).toHaveLength(1));
    expect(scheduleCalls()[0].body?.athleteIds).toEqual(["athlete-hao", "athlete-colin"]);
    expect(window.localStorage.getItem("performance-coach:workout-builder-draft:coach-1")).toBeNull();

    fireEvent.change(athleteSelect(), { target: { value: "athlete-cheryl" } });
    clickText(/\+ Add Workout|Resume draft/);
    clickText(/Build New Workout/);
    expect(assignTargets()).toEqual(["Cheryl Chao"]);
  });
});
