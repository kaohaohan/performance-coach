"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ApiError, apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import SignOutButton from "@/components/sign-out-button";

type Role = "COACH" | "ATHLETE";
type Exercise = {
  id: string;
  name: string;
  scope: "SYSTEM" | "PRIVATE";
};

function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : "Something went wrong. Please try again.";
}

export default function CoachExercisesPage() {
  const router = useRouter();
  const { user, idToken, loading: authLoading } = useAuth();
  const [role, setRole] = useState<Role | null>(null);
  const [roleError, setRoleError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [exercises, setExercises] = useState<Exercise[] | null>(null);
  const [loadingExercises, setLoadingExercises] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const [exerciseName, setExerciseName] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const roleRequestId = useRef(0);
  const exerciseRequestId = useRef(0);
  const createInFlight = useRef(false);

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [authLoading, user, router]);

  useEffect(() => {
    if (!idToken) return;

    const requestId = ++roleRequestId.current;
    let cancelled = false;
    (async () => {
      setRoleError(null);
      try {
        const me = await apiFetch<{ role: Role }>(idToken, "/api/v1/me");
        if (cancelled || requestId !== roleRequestId.current) return;
        if (me.role === "ATHLETE") {
          router.replace("/today");
          return;
        }
        setRole(me.role);
        setRoleError(null);
      } catch (error) {
        if (!cancelled && requestId === roleRequestId.current) setRoleError(errorMessage(error));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [idToken, router]);

  useEffect(() => {
    if (!idToken || role !== "COACH") return;

    const trimmedQuery = query.trim();
    const endpoint = trimmedQuery === ""
      ? "/api/v1/exercises"
      : `/api/v1/exercises?q=${encodeURIComponent(query)}`;
    const delay = trimmedQuery === "" ? 0 : 275;
    const requestId = ++exerciseRequestId.current;
    let cancelled = false;

    const timeoutId = window.setTimeout(() => {
      (async () => {
        if (!cancelled && requestId === exerciseRequestId.current) {
          setLoadingExercises(true);
          setLoadError(null);
        }
        try {
          const result = await apiFetch<Exercise[]>(idToken, endpoint);
          if (!cancelled && requestId === exerciseRequestId.current) {
            setExercises(result);
            setLoadError(null);
          }
        } catch (error) {
          if (!cancelled && requestId === exerciseRequestId.current) setLoadError(errorMessage(error));
        } finally {
          if (!cancelled && requestId === exerciseRequestId.current) setLoadingExercises(false);
        }
      })();
    }, delay);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [idToken, query, reloadKey, role]);

  function openCreate() {
    setCreateOpen(true);
    setCreateError(null);
  }

  function cancelCreate() {
    if (creating) return;
    setCreateOpen(false);
    setExerciseName("");
    setCreateError(null);
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (creating || createInFlight.current || !idToken) return;
    if (exerciseName.trim() === "") {
      setCreateError("Exercise name is required.");
      return;
    }

    createInFlight.current = true;
    setCreating(true);
    setCreateError(null);
    try {
      await apiFetch<Exercise>(idToken, "/api/v1/exercises", {
        method: "POST",
        body: { name: exerciseName },
      });
      setExerciseName("");
      setCreateOpen(false);
      setCreateError(null);
      setReloadKey((value) => value + 1);
    } catch (error) {
      setCreateError(errorMessage(error));
    } finally {
      createInFlight.current = false;
      setCreating(false);
    }
  }

  if (authLoading || (user && !idToken) || (user && !role && !roleError)) {
    return <main className="min-h-screen bg-stone-100 p-6 text-slate-700">Loading…</main>;
  }
  if (!user) return null;

  const systemExercises = exercises?.filter((exercise) => exercise.scope === "SYSTEM") ?? [];
  const privateExercises = exercises?.filter((exercise) => exercise.scope === "PRIVATE") ?? [];
  const hasNoResults = exercises !== null && exercises.length === 0;

  return (
    <main className="min-h-screen overflow-x-hidden bg-stone-100 pb-[max(2rem,env(safe-area-inset-bottom))] text-slate-900">
      <header className="bg-slate-950 px-5 pb-8 pt-[max(1.5rem,env(safe-area-inset-top))] text-white">
        <div className="mx-auto max-w-lg">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-teal-300">PumpLoop</p>
            <SignOutButton className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400 transition hover:text-white disabled:opacity-50" />
          </div>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">Exercise Library</h1>
          <p className="mt-2 max-w-sm text-sm leading-6 text-slate-300">Manage the movements you use in programming.</p>
          <button type="button" onClick={() => router.push("/coach/calendar")} className="mt-4 min-h-11 rounded-xl border border-slate-600 px-4 text-sm font-bold text-white transition hover:border-slate-400 hover:bg-slate-900">
            ← Coach Calendar
          </button>
        </div>
      </header>

      <div className="mx-auto -mt-3 flex max-w-lg flex-col gap-6 px-4">
        {roleError && <Notice>{roleError}</Notice>}

        {role === "COACH" && <>
          <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-950/5">
            <label className="block">
              <span className="sr-only">Search exercises</span>
              <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search exercises…" className="min-h-14 w-full rounded-2xl border border-slate-200 bg-stone-50 px-4 text-base font-medium outline-none placeholder:text-slate-400 focus:border-teal-600 focus:bg-white focus:ring-2 focus:ring-teal-600/15" />
            </label>
            {!createOpen && <button type="button" onClick={openCreate} className="mt-4 min-h-14 w-full rounded-2xl bg-teal-600 px-5 text-base font-bold text-white shadow-sm transition hover:bg-teal-700">+ Create Exercise</button>}

            {createOpen && <form onSubmit={handleCreate} className="mt-5 border-t border-slate-100 pt-5">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Create Exercise</p>
              <label className="mt-3 block">
                <span className="mb-1.5 block text-sm font-semibold text-slate-700">Exercise name</span>
                <input type="text" value={exerciseName} onChange={(event) => setExerciseName(event.target.value)} disabled={creating} autoFocus className="min-h-14 w-full rounded-xl border border-slate-200 bg-stone-50 px-4 text-base font-medium outline-none focus:border-teal-600 focus:bg-white focus:ring-2 focus:ring-teal-600/15 disabled:cursor-not-allowed disabled:bg-slate-100" />
              </label>
              {createError && <div className="mt-3"><Notice>{createError}</Notice></div>}
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <button type="submit" disabled={creating} className="min-h-14 rounded-2xl bg-teal-600 px-5 text-base font-bold text-white shadow-sm transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500">{creating ? "Creating exercise…" : "Create Exercise"}</button>
                <button type="button" onClick={cancelCreate} disabled={creating} className="min-h-14 rounded-2xl border border-slate-300 bg-white px-5 text-base font-bold text-slate-900 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50">Cancel</button>
              </div>
            </form>}
          </section>

          {loadError && <Notice>{loadError}</Notice>}

          {exercises === null ? <LoadingCard label={loadingExercises ? "Loading exercises…" : "Exercises could not be loaded."} /> : hasNoResults ? (
            <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-950/5">
              <h2 className="text-xl font-semibold tracking-tight">No exercises found.</h2>
              <p className="mt-2 text-sm leading-6 text-slate-500">Try another search or create a new exercise.</p>
              {!createOpen && <button type="button" onClick={openCreate} className="mt-4 min-h-11 rounded-xl bg-teal-600 px-4 text-sm font-bold text-white transition hover:bg-teal-700">Create Exercise</button>}
            </section>
          ) : <>
            <ExerciseSection title="System exercises" badge="SYSTEM" exercises={systemExercises} empty="No system exercises available yet." />
            <ExerciseSection title="My exercises" badge="PRIVATE" exercises={privateExercises} empty="You haven't created any exercises yet." onCreate={!createOpen ? openCreate : undefined} />
          </>}
        </>}
      </div>
    </main>
  );
}

function Notice({ children }: { children: string }) {
  return <p role="alert" className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700 ring-1 ring-red-600/10">{children}</p>;
}

function LoadingCard({ label }: { label: string }) {
  return <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-950/5"><p className="text-sm font-medium text-slate-500">{label}</p></section>;
}

function ExerciseSection({ title, badge, exercises, empty, onCreate }: { title: string; badge: Exercise["scope"]; exercises: Exercise[]; empty: string; onCreate?: () => void }) {
  return (
    <section>
      <div className="mb-3 px-1">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{title}</p>
      </div>
      {exercises.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-slate-200 bg-stone-50 px-5 py-5">
          <p className="text-sm leading-6 text-slate-500">{empty}</p>
          {onCreate && <button type="button" onClick={onCreate} className="mt-4 min-h-11 rounded-xl bg-teal-600 px-4 text-sm font-bold text-white transition hover:bg-teal-700">Create Exercise</button>}
        </div>
      ) : (
        <ul className="overflow-hidden rounded-3xl bg-white shadow-sm ring-1 ring-slate-950/5">
          {exercises.map((exercise, index) => <li key={exercise.id} className={`flex min-h-14 items-center justify-between gap-3 px-5 py-3 ${index > 0 ? "border-t border-slate-100" : ""}`}>
            <p className="min-w-0 break-words font-semibold">{exercise.name}</p>
            <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold tracking-wide ${badge === "SYSTEM" ? "bg-slate-100 text-slate-600" : "bg-teal-50 text-teal-700"}`}>{badge}</span>
          </li>)}
        </ul>
      )}
    </section>
  );
}
