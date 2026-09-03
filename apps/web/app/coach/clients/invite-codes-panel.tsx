"use client";

// Invite Codes tab (docs/athlete-onboarding-invite-codes-v0.1.md §7.2).
// Owns its own list + revoke state; the coach's own status. `status` on
// each row comes straight from the API (already derived server-side, §4)
// — this component only maps it to a color, never re-derives it.
import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import { useLocale, useT, type Locale, type MessageKey } from "@/lib/i18n";
import { monthDayYear } from "@/lib/i18n/dates";
import { errorMessage, type ErrorPolicy } from "@/lib/i18n/errors";

type InviteCode = {
  id: string;
  code: string;
  description: string | null;
  status: "ACTIVE" | "EXPIRED" | "REVOKED";
  expiresAt: string;
  revokedAt: string | null;
  createdAt: string;
};

// The Go API is the authority on why it rejected a call, so its own copy is
// passed through; anything else falls back to errors.unexpected.
const API_ERROR_POLICY: ErrorPolicy = { serverMessage: true };

function formatCode(code: string): string {
  return `${code.slice(0, 5)}-${code.slice(5)}`;
}

// `expiresAt` is a full ISO instant, not a calendar day; monthDayYear reads
// it as one and renders the coach's own date — en "Sep 3, 2026",
// zh-TW "2026年9月3日".
function formatDate(locale: Locale, iso: string): string {
  return monthDayYear(locale, iso);
}

function inviteLink(code: string): string {
  return `${window.location.origin}/join/${code}`;
}

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Non-secure context or older browser: fall back to a hidden, selected
    // textarea so the coach can still copy manually.
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
}

const STATUS_KEYS: Record<InviteCode["status"], MessageKey> = {
  ACTIVE: "coach.codeStatus.active",
  EXPIRED: "coach.codeStatus.expired",
  REVOKED: "coach.codeStatus.revoked",
};

function statusChipClass(status: InviteCode["status"]): string {
  switch (status) {
    case "ACTIVE": return "bg-teal-50 text-teal-700 ring-teal-600/20";
    case "EXPIRED": return "bg-slate-100 text-slate-600 ring-slate-950/10";
    case "REVOKED": return "bg-rose-50 text-rose-700 ring-rose-600/20";
  }
}

export default function InviteCodesPanel({ idToken, reloadToken }: { idToken: string; reloadToken: number }) {
  const t = useT();
  const { locale } = useLocale();
  const [codes, setCodes] = useState<InviteCode[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [revokeError, setRevokeError] = useState<string | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<InviteCode | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const requestId = useRef(0);

  useEffect(() => {
    const id = ++requestId.current;
    let cancelled = false;
    (async () => {
      setLoadError(null);
      try {
        const result = await apiFetch<InviteCode[]>(idToken, "/api/v1/invite-codes");
        if (!cancelled && id === requestId.current) setCodes(result);
      } catch (error) {
        if (!cancelled && id === requestId.current) setLoadError(errorMessage(t, error, API_ERROR_POLICY));
      }
    })();
    return () => { cancelled = true; };
  }, [idToken, reloadToken, t]);

  async function handleCopy(field: string, text: string) {
    await copyText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField((current) => (current === field ? null : current)), 2000);
  }

  async function handleRevoke(target: InviteCode) {
    setConfirmTarget(null);
    setRevokeError(null);
    setRevokingId(target.id);
    try {
      const revoked = await apiFetch<InviteCode>(idToken, `/api/v1/invite-codes/${encodeURIComponent(target.id)}/revoke`, { method: "POST" });
      setCodes((current) => current?.map((code) => (code.id === revoked.id ? revoked : code)) ?? current);
    } catch (error) {
      setRevokeError(errorMessage(t, error, API_ERROR_POLICY));
    } finally {
      setRevokingId(null);
    }
  }

  return (
    <section>
      {loadError && <Notice>{loadError}</Notice>}
      {revokeError && <Notice>{revokeError}</Notice>}

      {codes === null ? (
        <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-950/5"><p className="text-sm font-medium text-slate-500">{t("coach.codes.loading")}</p></section>
      ) : codes.length === 0 ? (
        <section className="rounded-3xl border border-dashed border-slate-200 bg-stone-50 px-5 py-6 text-center">
          <p className="font-semibold">{t("coach.codes.empty")}</p>
          <p className="mt-1 text-sm text-slate-500">{t("coach.codes.emptyHint")}</p>
        </section>
      ) : (
        <>
          <div className="hidden overflow-hidden rounded-3xl bg-white shadow-sm ring-1 ring-slate-950/5 sm:block">
            <table className="w-full text-left text-sm">
              <thead className="bg-stone-50 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                <tr>
                  <th className="px-5 py-3 font-semibold">{t("coach.col.description")}</th>
                  <th className="px-5 py-3 font-semibold">{t("coach.col.joinCode")}</th>
                  <th className="px-5 py-3 font-semibold">{t("coach.col.expires")}</th>
                  <th className="px-5 py-3 font-semibold">{t("coach.col.status")}</th>
                  <th className="px-5 py-3 text-right font-semibold">{t("coach.col.actions")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {codes.map((code) => (
                  <tr key={code.id} className="align-top">
                    <td className="px-5 py-3 font-medium text-slate-700">{code.description ?? <span className="text-slate-400">—</span>}</td>
                    <td className="px-5 py-3 font-mono text-sm tracking-wide text-slate-900">{formatCode(code.code)}</td>
                    <td className="px-5 py-3 text-slate-600">{formatDate(locale, code.expiresAt)}</td>
                    <td className="px-5 py-3"><span className={`rounded-full px-2.5 py-1 text-[11px] font-bold tracking-wide ring-1 ${statusChipClass(code.status)}`}>{t(STATUS_KEYS[code.status])}</span></td>
                    <td className="px-5 py-3">
                      <div className="flex flex-wrap justify-end gap-2">
                        <button type="button" onClick={() => handleCopy(`link-${code.id}`, inviteLink(code.code))} className="min-h-11 rounded-lg px-2.5 text-sm font-bold text-slate-700 transition hover:bg-stone-100">{copiedField === `link-${code.id}` ? t("coach.invite.copied") : t("coach.invite.copyLink")}</button>
                        <button type="button" onClick={() => handleCopy(`code-${code.id}`, formatCode(code.code))} className="min-h-11 rounded-lg px-2.5 text-sm font-bold text-slate-700 transition hover:bg-stone-100">{copiedField === `code-${code.id}` ? t("coach.invite.copied") : t("coach.invite.copyCode")}</button>
                        <button type="button" disabled={code.status !== "ACTIVE" || revokingId === code.id} onClick={() => setConfirmTarget(code)} className="min-h-11 rounded-lg px-2.5 text-sm font-bold text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-transparent">{revokingId === code.id ? t("coach.codes.revoking") : t("coach.codes.revoke")}</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="grid gap-3 sm:hidden">
            {codes.map((code) => (
              <li key={code.id} className="rounded-3xl bg-white p-4 shadow-sm ring-1 ring-slate-950/5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-900">{code.description ?? t("coach.codes.untitled")}</p>
                    <p className="mt-0.5 font-mono text-sm tracking-wide text-slate-600">{formatCode(code.code)}</p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold tracking-wide ring-1 ${statusChipClass(code.status)}`}>{t(STATUS_KEYS[code.status])}</span>
                </div>
                <p className="mt-2 text-xs text-slate-500">{t("coach.invite.expiresOn", { date: formatDate(locale, code.expiresAt) })}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" onClick={() => handleCopy(`link-${code.id}`, inviteLink(code.code))} className="min-h-11 flex-1 rounded-xl bg-stone-50 px-3 text-sm font-bold text-slate-700 transition hover:bg-stone-100">{copiedField === `link-${code.id}` ? t("coach.invite.copied") : t("coach.invite.copyLink")}</button>
                  <button type="button" onClick={() => handleCopy(`code-${code.id}`, formatCode(code.code))} className="min-h-11 flex-1 rounded-xl bg-stone-50 px-3 text-sm font-bold text-slate-700 transition hover:bg-stone-100">{copiedField === `code-${code.id}` ? t("coach.invite.copied") : t("coach.invite.copyCode")}</button>
                  <button type="button" disabled={code.status !== "ACTIVE" || revokingId === code.id} onClick={() => setConfirmTarget(code)} className="min-h-11 flex-1 rounded-xl bg-stone-50 px-3 text-sm font-bold text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-stone-50">{revokingId === code.id ? t("coach.codes.revoking") : t("coach.codes.revoke")}</button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {confirmTarget && (
        <RevokeConfirmDialog
          code={confirmTarget}
          onConfirm={() => handleRevoke(confirmTarget)}
          onCancel={() => setConfirmTarget(null)}
        />
      )}
    </section>
  );
}

function Notice({ children }: { children: string }) {
  return <p role="alert" className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700 ring-1 ring-red-600/10">{children}</p>;
}

function RevokeConfirmDialog({ code, onConfirm, onCancel }: { code: InviteCode; onConfirm: () => void; onCancel: () => void }) {
  const t = useT();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    containerRef.current?.querySelector<HTMLElement>("button")?.focus();
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/40 p-4 sm:items-center" role="presentation" onClick={onCancel}>
      <div ref={containerRef} role="alertdialog" aria-modal="true" aria-labelledby="revoke-dialog-title" className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-xl" onClick={(event) => event.stopPropagation()}>
        <h2 id="revoke-dialog-title" className="text-lg font-semibold tracking-tight">{t("coach.codes.revokeTitle")}</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">{t("coach.codes.revokeBody", {
          // The coach's own description is never translated, so the whole
          // identifier is assembled here and interpolated as one value.
          code: code.description ? `“${code.description}” (${formatCode(code.code)})` : formatCode(code.code),
        })}</p>
        <div className="mt-6 flex gap-3">
          <button type="button" onClick={onCancel} className="min-h-14 flex-1 rounded-2xl border border-slate-200 text-base font-bold text-slate-700 transition hover:bg-stone-50">{t("common.cancel")}</button>
          <button type="button" onClick={onConfirm} className="min-h-14 flex-1 rounded-2xl bg-red-600 text-base font-bold text-white shadow-sm transition hover:bg-red-700">{t("coach.codes.revoke")}</button>
        </div>
      </div>
    </div>
  );
}
