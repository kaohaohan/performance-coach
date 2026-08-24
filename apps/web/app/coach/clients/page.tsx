"use client";

import { Suspense, useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ApiError, apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import SignOutButton from "@/components/sign-out-button";
import InviteCodesPanel from "./invite-codes-panel";

type Role = "COACH" | "ATHLETE";
type Athlete = { id: string; name: string; role: "ATHLETE" };
type InviteCode = {
  id: string;
  code: string;
  description: string | null;
  status: "ACTIVE" | "EXPIRED" | "REVOKED";
  expiresAt: string;
  revokedAt: string | null;
  createdAt: string;
};

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

function formatCode(code: string): string {
  return `${code.slice(0, 5)}-${code.slice(5)}`;
}

function formatExpiry(iso: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(iso));
}

// useFocusTrap keeps keyboard focus inside a modal dialog while it's open:
// Tab/Shift+Tab wrap within the container's focusable elements, Escape
// calls onClose. It intentionally does not restore focus itself on
// cleanup — callers pass an onClose that already does that (e.g. focusing
// the trigger button), see CreateInviteModal below
// (docs/athlete-onboarding-invite-codes-v0.1.md §7.3 modal a11y).
function useFocusTrap(containerRef: React.RefObject<HTMLElement | null>, onClose: () => void) {
  useEffect(() => {
    const focusableSelector = 'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';
    const focusables = () => Array.from(containerRef.current?.querySelectorAll<HTMLElement>(focusableSelector) ?? []);
    focusables()[0]?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

export default function CoachClientsPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-stone-100 p-6 text-slate-700">Loading…</main>}>
      <CoachClientsPageInner />
    </Suspense>
  );
}

function CoachClientsPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tab = searchParams.get("tab") === "codes" ? "codes" : "athletes";
  const { user, idToken, loading: authLoading } = useAuth();
  const [role, setRole] = useState<Role | null>(null);
  const [roleError, setRoleError] = useState<string | null>(null);
  const [athletes, setAthletes] = useState<Athlete[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [codesReloadToken, setCodesReloadToken] = useState(0);
  const roleRequestId = useRef(0);
  const athleteRequestId = useRef(0);
  const createTriggerRef = useRef<HTMLButtonElement>(null);

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

  async function handleRemoveAthlete(athleteId: string) {
    if (!idToken) return;
    setRemoveError(null);
    const previous = athletes;
    setAthletes((current) => current?.filter((athlete) => athlete.id !== athleteId) ?? current);
    try {
      await apiFetch<void>(idToken, `/api/v1/athletes/${encodeURIComponent(athleteId)}`, { method: "DELETE" });
    } catch (error) {
      setAthletes(previous);
      setRemoveError(errorMessage(error));
    }
  }

  function closeCreateModal() {
    setShowCreateModal(false);
    setCodesReloadToken((token) => token + 1);
    createTriggerRef.current?.focus();
  }

  if (authLoading || (user && !idToken) || (user && !role && !roleError)) {
    return <main className="min-h-screen bg-stone-100 p-6 text-slate-700">Loading…</main>;
  }
  if (!user) return null;

  return (
    <main className="min-h-screen bg-stone-100 pb-[max(2rem,env(safe-area-inset-bottom))] text-slate-900">
      <header className="bg-slate-950 px-5 pb-8 pt-[max(1.5rem,env(safe-area-inset-top))] text-white">
        <div className="mx-auto max-w-lg">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-teal-300">Performance Coach</p>
            <SignOutButton className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400 transition hover:text-white disabled:opacity-50" />
          </div>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">Clients</h1>
          <p className="mt-2 text-sm text-slate-300">Your connected athletes.</p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => router.push("/coach/calendar")} className="min-h-11 rounded-xl border border-slate-600 px-4 text-sm font-bold text-white transition hover:border-slate-400 hover:bg-slate-900">← Coach Calendar</button>
            {role === "COACH" && (
              <button ref={createTriggerRef} type="button" onClick={() => setShowCreateModal(true)} className="min-h-11 rounded-xl bg-teal-600 px-4 text-sm font-bold text-white shadow-sm transition hover:bg-teal-700">+ Invite Athletes</button>
            )}
          </div>
        </div>
      </header>

      <div className="mx-auto -mt-3 flex max-w-lg flex-col gap-4 px-4">
        {roleError && <Notice>{roleError}</Notice>}
        {role === "COACH" && (
          <>
            <nav aria-label="Clients sections" className="flex gap-2">
              <Link href="/coach/clients?tab=athletes" className={tabLinkClass(tab === "athletes")}>Athletes</Link>
              <Link href="/coach/clients?tab=codes" className={tabLinkClass(tab === "codes")}>Invite Codes</Link>
            </nav>

            {tab === "athletes" ? (
              <AthletesTab
                athletes={athletes}
                loadError={loadError}
                removeError={removeError}
                onRemove={handleRemoveAthlete}
                onRequestInvite={() => setShowCreateModal(true)}
                onOpenAthlete={(athleteId) => router.push(`/coach/clients/${encodeURIComponent(athleteId)}`)}
              />
            ) : idToken ? (
              <InviteCodesPanel idToken={idToken} reloadToken={codesReloadToken} />
            ) : null}
          </>
        )}
      </div>

      {showCreateModal && idToken && <CreateInviteModal idToken={idToken} onClose={closeCreateModal} />}
    </main>
  );
}

function tabLinkClass(active: boolean): string {
  return `min-h-11 rounded-xl px-4 text-sm font-bold transition ${active ? "bg-slate-950 text-white" : "bg-white text-slate-600 ring-1 ring-slate-950/5 hover:bg-stone-50"} flex items-center`;
}

function AthletesTab({
  athletes,
  loadError,
  removeError,
  onRemove,
  onRequestInvite,
  onOpenAthlete,
}: {
  athletes: Athlete[] | null;
  loadError: string | null;
  removeError: string | null;
  onRemove: (athleteId: string) => void;
  onRequestInvite: () => void;
  onOpenAthlete: (athleteId: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [confirmTarget, setConfirmTarget] = useState<Athlete | null>(null);

  const filtered = athletes?.filter((athlete) => athlete.name.toLowerCase().includes(search.trim().toLowerCase())) ?? null;

  return (
    <section>
      {loadError && <Notice>{loadError}</Notice>}
      {removeError && <Notice>{removeError}</Notice>}

      {athletes === null ? (
        <LoadingCard label="Loading connected athletes…" />
      ) : athletes.length === 0 ? (
        <section className="rounded-3xl border border-dashed border-slate-200 bg-stone-50 px-5 py-6 text-center">
          <p className="font-semibold">No athletes yet. Create an invite code and send the link.</p>
          <button type="button" onClick={onRequestInvite} className="mt-4 min-h-14 rounded-2xl bg-teal-600 px-5 text-base font-bold text-white shadow-sm transition hover:bg-teal-700">+ Invite Athletes</button>
        </section>
      ) : (
        <>
          <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search athletes" aria-label="Search athletes" className="min-h-14 w-full rounded-2xl border border-slate-200 bg-white px-4 text-base outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-600/15" />

          {filtered && filtered.length === 0 ? (
            <p className="mt-3 px-1 text-sm font-medium text-slate-500">No athletes match &ldquo;{search}&rdquo;.</p>
          ) : (
            <>
              <div className="mt-3 hidden overflow-hidden rounded-3xl bg-white shadow-sm ring-1 ring-slate-950/5 sm:block">
                <table className="w-full text-left text-sm">
                  <thead className="bg-stone-50 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                    <tr>
                      <th className="px-5 py-3 font-semibold">Name</th>
                      <th className="px-5 py-3 font-semibold">Status</th>
                      <th className="px-5 py-3 text-right font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filtered!.map((athlete) => (
                      <tr key={athlete.id} className="transition hover:bg-stone-50">
                        <td className="px-5 py-3">
                          <button type="button" onClick={() => onOpenAthlete(athlete.id)} className="flex items-center gap-3 text-left font-semibold text-slate-900 hover:text-teal-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-600">
                            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-slate-100 text-xs font-bold text-slate-600">{initials(athlete.name)}</span>
                            {athlete.name}
                          </button>
                        </td>
                        <td className="px-5 py-3"><StatusChip /></td>
                        <td className="px-5 py-3 text-right">
                          <button type="button" onClick={() => setConfirmTarget(athlete)} className="min-h-11 rounded-lg px-3 text-sm font-bold text-red-700 transition hover:bg-red-50">Remove</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <ul className="mt-3 overflow-hidden rounded-3xl bg-white shadow-sm ring-1 ring-slate-950/5 sm:hidden">
                {filtered!.map((athlete, index) => (
                  <li key={athlete.id} className={`flex items-center gap-1 px-3 ${index > 0 ? "border-t border-slate-100" : ""}`}>
                    <button type="button" onClick={() => onOpenAthlete(athlete.id)} className="flex min-h-16 flex-1 items-center gap-3 py-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-teal-600">
                      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-slate-100 text-sm font-bold text-slate-600">{initials(athlete.name)}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block break-words font-semibold">{athlete.name}</span>
                        <span className="mt-0.5 block text-xs font-bold uppercase tracking-wide text-teal-700">Connected</span>
                      </span>
                    </button>
                    <button type="button" onClick={() => setConfirmTarget(athlete)} aria-label={`Remove ${athlete.name}`} className="min-h-11 shrink-0 rounded-lg px-3 text-sm font-bold text-red-700 transition hover:bg-red-50">Remove</button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}

      {confirmTarget && (
        <ConfirmDialog
          title={`Remove ${confirmTarget.name}?`}
          body="They'll no longer appear in your roster, and you won't be able to schedule new training for them. Their existing history is unaffected."
          confirmLabel="Remove"
          danger
          onConfirm={() => { onRemove(confirmTarget.id); setConfirmTarget(null); }}
          onCancel={() => setConfirmTarget(null)}
        />
      )}
    </section>
  );
}

function StatusChip() {
  return <span className="rounded-full bg-teal-50 px-2.5 py-1 text-[11px] font-bold tracking-wide text-teal-700 ring-1 ring-teal-600/20">Connected</span>;
}

function ConfirmDialog({
  title,
  body,
  confirmLabel,
  danger,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  useFocusTrap(containerRef, onCancel);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/40 p-4 sm:items-center" role="presentation" onClick={onCancel}>
      <div ref={containerRef} role="alertdialog" aria-modal="true" aria-labelledby="confirm-dialog-title" className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-xl" onClick={(event) => event.stopPropagation()}>
        <h2 id="confirm-dialog-title" className="text-lg font-semibold tracking-tight">{title}</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">{body}</p>
        <div className="mt-6 flex gap-3">
          <button type="button" onClick={onCancel} className="min-h-14 flex-1 rounded-2xl border border-slate-200 text-base font-bold text-slate-700 transition hover:bg-stone-50">Cancel</button>
          <button type="button" onClick={onConfirm} className={`min-h-14 flex-1 rounded-2xl text-base font-bold text-white shadow-sm transition ${danger ? "bg-red-600 hover:bg-red-700" : "bg-teal-600 hover:bg-teal-700"}`}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

function CreateInviteModal({ idToken, onClose }: { idToken: string; onClose: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState<"form" | "success">("form");
  const [description, setDescription] = useState("");
  const [expiresInDays, setExpiresInDays] = useState<7 | 30 | 90>(30);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<InviteCode | null>(null);
  const [copied, setCopied] = useState<"link" | "code" | null>(null);

  useFocusTrap(containerRef, onClose);

  function inviteLink(code: string): string {
    return `${window.location.origin}/join/${code}`;
  }

  async function copy(text: string, field: "link" | "code") {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Non-secure context or older browser: fall back to a hidden,
      // selected textarea so the coach can still copy manually.
      const el = document.createElement("textarea");
      el.value = text;
      el.style.position = "fixed";
      el.style.opacity = "0";
      document.body.appendChild(el);
      el.focus();
      el.select();
      try { document.execCommand("copy"); } catch { /* best-effort */ }
      document.body.removeChild(el);
    }
    setCopied(field);
    setTimeout(() => setCopied((current) => (current === field ? null : current)), 2000);
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const trimmed = description.trim();
      const result = await apiFetch<InviteCode>(idToken, "/api/v1/invite-codes", {
        method: "POST",
        body: { description: trimmed === "" ? null : trimmed, expiresInDays },
      });
      setCreated(result);
      setStep("success");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/40 p-4 sm:items-center" role="presentation">
      <div ref={containerRef} role="dialog" aria-modal="true" aria-labelledby="invite-modal-title" className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-xl">
        {step === "form" ? (
          <form onSubmit={handleCreate}>
            <h2 id="invite-modal-title" className="text-xl font-semibold tracking-tight">Invite athletes</h2>
            <label className="mt-5 block">
              <span className="mb-1.5 block text-sm font-semibold text-slate-700">Description (optional)</span>
              <input type="text" value={description} onChange={(event) => setDescription(event.target.value)} maxLength={120} placeholder="Fall squad" className="min-h-14 w-full rounded-xl border border-slate-200 bg-stone-50 px-4 text-base outline-none focus:border-teal-600 focus:bg-white focus:ring-2 focus:ring-teal-600/15" />
              <span className="mt-1.5 block text-xs text-slate-500">Athletes see this when they open the link.</span>
            </label>
            <div className="mt-5">
              <span className="mb-1.5 block text-sm font-semibold text-slate-700">Expires in</span>
              <div className="grid grid-cols-3 gap-2">
                {([7, 30, 90] as const).map((days) => (
                  <button key={days} type="button" onClick={() => setExpiresInDays(days)} aria-pressed={expiresInDays === days} className={`min-h-14 rounded-xl text-sm font-bold ring-1 transition ${expiresInDays === days ? "bg-teal-600 text-white ring-teal-600" : "bg-stone-50 text-slate-700 ring-slate-200 hover:bg-stone-100"}`}>{days} days</button>
                ))}
              </div>
            </div>
            {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 px-3 py-2.5 text-sm font-medium text-red-700">{error}</p>}
            <div className="mt-6 flex gap-3">
              <button type="button" onClick={onClose} className="min-h-14 flex-1 rounded-2xl border border-slate-200 text-base font-bold text-slate-700 transition hover:bg-stone-50">Cancel</button>
              <button type="submit" disabled={submitting} className="min-h-14 flex-1 rounded-2xl bg-teal-600 text-base font-bold text-white shadow-sm transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500">{submitting ? "Creating…" : "Create invite"}</button>
            </div>
          </form>
        ) : created ? (
          <div>
            <h2 id="invite-modal-title" className="text-xl font-semibold tracking-tight">Invite ready</h2>
            <p className="mt-4 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Join code</p>
            <p className="mt-1 font-mono text-2xl font-bold tracking-widest text-slate-900">{formatCode(created.code)}</p>
            <button type="button" onClick={() => copy(formatCode(created.code), "code")} className="mt-3 min-h-14 w-full rounded-2xl border border-slate-200 text-base font-bold text-slate-700 transition hover:bg-stone-50">{copied === "code" ? "Copied ✓" : "Copy code"}</button>

            <p className="mt-5 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Invite link</p>
            <p className="mt-1 break-all rounded-xl bg-stone-50 px-3 py-2 text-sm text-slate-600">{inviteLink(created.code)}</p>
            <button type="button" onClick={() => copy(inviteLink(created.code), "link")} className="mt-3 min-h-14 w-full rounded-2xl bg-teal-600 text-base font-bold text-white shadow-sm transition hover:bg-teal-700">{copied === "link" ? "Copied ✓" : "Copy link"}</button>

            <p className="mt-5 text-sm text-slate-500">Expires {formatExpiry(created.expiresAt)}{created.description ? ` · ${created.description}` : ""}</p>
            <p className="mt-4 text-sm font-medium text-slate-600">Send it over LINE, WhatsApp, or email.</p>
            <button type="button" onClick={onClose} className="mt-4 min-h-14 w-full rounded-2xl border border-slate-200 text-base font-bold text-slate-700 transition hover:bg-stone-50">Done</button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Notice({ children }: { children: string }) {
  return <p role="alert" className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700 ring-1 ring-red-600/10">{children}</p>;
}

function LoadingCard({ label }: { label: string }) {
  return <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-950/5"><p className="text-sm font-medium text-slate-500">{label}</p></section>;
}
