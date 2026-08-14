"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

type Role = "COACH" | "ATHLETE";
type Athlete = { id: string; name: string; role: "ATHLETE" };

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : "Something went wrong. Please try again.";
}

export default function CoachClientsPage() {
  const router = useRouter();
  const { user, idToken, loading: authLoading } = useAuth();
  const [role, setRole] = useState<Role | null>(null);
  const [roleError, setRoleError] = useState<string | null>(null);
  const [athletes, setAthletes] = useState<Athlete[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const roleRequestId = useRef(0);
  const athleteRequestId = useRef(0);

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
      } catch (error) {
        if (!cancelled && requestId === roleRequestId.current) setRoleError(errorMessage(error));
      }
    })();
    return () => { cancelled = true; };
  }, [idToken, router]);

  useEffect(() => {
    if (!idToken || role !== "COACH") return;
    const requestId = ++athleteRequestId.current;
    let cancelled = false;
    (async () => {
      setLoadError(null);
      try {
        const result = await apiFetch<Athlete[]>(idToken, "/api/v1/athletes");
        if (!cancelled && requestId === athleteRequestId.current) {
          setAthletes(result);
          setLoadError(null);
        }
      } catch (error) {
        if (!cancelled && requestId === athleteRequestId.current) setLoadError(errorMessage(error));
      }
    })();
    return () => { cancelled = true; };
  }, [idToken, role]);

  if (authLoading || (user && !idToken) || (user && !role && !roleError)) {
    return <main className="min-h-screen bg-stone-100 p-6 text-slate-700">Loading…</main>;
  }
  if (!user) return null;

  return (
    <main className="min-h-screen bg-stone-100 pb-[max(2rem,env(safe-area-inset-bottom))] text-slate-900">
      <header className="bg-slate-950 px-5 pb-8 pt-[max(1.5rem,env(safe-area-inset-top))] text-white">
        <div className="mx-auto max-w-lg">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-teal-300">Performance Coach</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">Clients</h1>
          <p className="mt-2 text-sm text-slate-300">Your connected athletes.</p>
          <button type="button" onClick={() => router.push("/coach/calendar")} className="mt-4 min-h-11 rounded-xl border border-slate-600 px-4 text-sm font-bold text-white transition hover:border-slate-400 hover:bg-slate-900">← Coach Calendar</button>
        </div>
      </header>

      <div className="mx-auto -mt-3 flex max-w-lg flex-col gap-4 px-4">
        {roleError && <Notice>{roleError}</Notice>}
        {role === "COACH" && <section>
          <div className="mb-3 px-1">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Connected athletes</p>
          </div>
          {loadError && <Notice>{loadError}</Notice>}
          {athletes === null ? <LoadingCard label="Loading connected athletes…" /> : athletes.length === 0 ? <EmptyCard title="No connected athletes yet." /> : (
            <ul className="overflow-hidden rounded-3xl bg-white shadow-sm ring-1 ring-slate-950/5">
              {athletes.map((athlete, index) => (
                <li key={athlete.id} className={index > 0 ? "border-t border-slate-100" : ""}>
                  <button type="button" onClick={() => router.push(`/coach/clients/${encodeURIComponent(athlete.id)}`)} className="flex min-h-16 w-full items-center gap-3 px-5 py-3 text-left transition hover:bg-stone-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-teal-600">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-slate-100 text-sm font-bold text-slate-600">{initials(athlete.name)}</span>
                    <span className="min-w-0 flex-1 break-words font-semibold">{athlete.name}</span>
                    <span aria-hidden="true" className="text-xl font-medium text-slate-400">›</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>}
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

function EmptyCard({ title }: { title: string }) {
  return <section className="rounded-3xl border border-dashed border-slate-200 bg-stone-50 px-5 py-5"><p className="font-semibold">{title}</p></section>;
}
