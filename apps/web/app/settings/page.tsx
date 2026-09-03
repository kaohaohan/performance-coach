"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { apiFetch } from "@/lib/api";
import { ConfirmDialog } from "@/components/confirm-dialog";
import SignOutButton from "@/components/sign-out-button";
import { AppHeader } from "@/components/app-header";
import { LOCALE_LABELS, SUPPORTED_LOCALES, useLocale, useT } from "@/lib/i18n";
import { errorMessage, type ErrorPolicy } from "@/lib/i18n/errors";
import {
  AccountDeletionError,
  deleteCurrentAccount,
  deletionReauthKind,
  providerIds,
  settingsExitHref,
} from "@/lib/account-deletion";
import { createBrowserDeletionGateway } from "@/lib/account-deletion-browser";
import { Capacitor } from "@capacitor/core";

type Me = { id: string; name: string; role: "COACH" | "ATHLETE" };

// The profile read is a plain Go API call, so the server's own explanation of
// a refusal is the most useful thing to show; anything else falls back to
// errors.unexpected, as the page's old local errorMessage() did.
const API_ERROR_POLICY: ErrorPolicy = { serverMessage: true };

// LanguageSelector is the user-visible deliverable of the whole i18n task: it
// is the only way someone already stranded in a language they cannot read
// gets out.
//
// Two rules follow from that and are not stylistic:
//   - each language is named in itself (LOCALE_LABELS), never translated, so
//     the row you are looking for reads the same whichever locale is active;
//   - setLocale re-renders in place. No sign-out, no reload, no navigation —
//     the provider writes localStorage and swaps the catalog (lib/i18n).
//
// Rendered for both roles: an athlete needs it exactly as much as a coach,
// and /settings is the one screen both of them reach.
function LanguageSelector() {
  const t = useT();
  const { locale, setLocale } = useLocale();

  return (
    <section className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-950/5">
      <h2 className="text-lg font-semibold tracking-tight">{t("settings.language.heading")}</h2>
      <p className="mt-2 text-sm leading-6 text-slate-600">{t("settings.language.description")}</p>
      <div role="radiogroup" aria-label={t("settings.language.label")} className="mt-5 flex flex-col gap-2">
        {SUPPORTED_LOCALES.map((option) => {
          const selected = option === locale;
          return (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => setLocale(option)}
              className={`flex min-h-14 w-full items-center justify-between rounded-2xl border px-5 text-base font-bold transition ${selected ? "border-teal-600 bg-teal-50 text-teal-800" : "border-slate-200 bg-white text-slate-700 hover:bg-stone-50"}`}
            >
              {/* lang= so the browser picks the right font for the label even
                  while the rest of the page is in the other language. */}
              <span lang={option}>{LOCALE_LABELS[option]}</span>
              {selected && <span aria-hidden="true" className="text-lg leading-none">✓</span>}
            </button>
          );
        })}
      </div>
    </section>
  );
}

export default function SettingsPage() {
  const router = useRouter();
  const { user, idToken, loading: authLoading } = useAuth();
  const t = useT();
  const [me, setMe] = useState<Me | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [password, setPassword] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [authLoading, user, router]);

  useEffect(() => {
    if (!idToken) return;
    let cancelled = false;
    (async () => {
      try {
        const profile = await apiFetch<Me>(idToken, "/api/v1/me");
        if (!cancelled) setMe(profile);
      } catch (err) {
        if (!cancelled) setLoadError(errorMessage(t, err, API_ERROR_POLICY));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [idToken, t]);

  const reauthKind = user
    ? deletionReauthKind(providerIds(user), Capacitor.isNativePlatform())
    : "unsupported";

  async function handleConfirmDelete() {
    if (deleting) return;
    if (reauthKind === "password" && password.trim() === "") {
      setDeleteError(t("settings.delete.passwordRequired"));
      return;
    }
    setConfirming(false);
    setDeleting(true);
    setDeleteError(null);
    try {
      const result = await deleteCurrentAccount(
        createBrowserDeletionGateway(async () => (reauthKind === "password" ? password : null)),
      );
      if (result === "cancelled") {
        setDeleting(false);
        return;
      }
      router.replace("/login");
    } catch (err) {
      // AccountDeletionError carries copy written by lib/account-deletion.ts,
      // which is still English-only: its messages are plain strings, not
      // catalog keys, and giving them keys means changing that module and its
      // tests — outside this sub-task's files. Tracked as a follow-up in the
      // task doc. The fallback below, which this page owns, is translated.
      const message = err instanceof AccountDeletionError
        ? err.message
        : t("settings.delete.failed");
      setDeleteError(message);
      setDeleting(false);
    }
  }

  if (authLoading || (user && !idToken)) return <main className="min-h-screen bg-stone-100 p-6 text-slate-700">{t("common.loading")}</main>;
  if (!user) return null;

  const exitHref = me ? settingsExitHref(me.role) : "/login";

  return (
    <main className="min-h-screen bg-stone-100 pb-[max(2rem,env(safe-area-inset-bottom))] text-slate-900">
      <AppHeader
        actions={<SignOutButton className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400 transition hover:text-white disabled:opacity-50" />}
      >
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">{t("settings.heading")}</h1>
        <p className="mt-2 text-sm text-slate-300">{t("settings.subtitle")}</p>
        <button
          type="button"
          onClick={() => router.push(exitHref)}
          className="mt-4 min-h-11 rounded-xl border border-slate-600 px-4 text-sm font-bold text-white transition hover:border-slate-400 hover:bg-slate-900"
        >
          {me?.role === "ATHLETE" ? t("settings.backToToday") : t("settings.backToCalendar")}
        </button>
      </AppHeader>

      <div className="mx-auto -mt-3 flex max-w-lg flex-col gap-4 px-4">
        {loadError && <p role="alert" className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700 ring-1 ring-red-600/10">{loadError}</p>}
        {deleteError && <p role="alert" className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700 ring-1 ring-red-600/10">{deleteError}</p>}

        <section className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-950/5">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">{t("settings.signedInAs")}</p>
          <p className="mt-2 text-lg font-semibold">{me?.name ?? "…"}</p>
          {me && <p className="mt-1 text-sm font-medium text-slate-500">{me.role === "COACH" ? t("settings.roleCoach") : t("settings.roleAthlete")}</p>}
        </section>

        <LanguageSelector />

        <section className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-red-600/10">
          <h2 className="text-lg font-semibold tracking-tight">{t("settings.delete.heading")}</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            {t("settings.delete.description")}
          </p>
          <button
            type="button"
            onClick={() => {
              setDeleteError(null);
              setPassword("");
              setConfirming(true);
            }}
            disabled={deleting || !me}
            className="mt-5 min-h-14 w-full rounded-2xl bg-red-600 px-5 text-base font-bold text-white shadow-sm transition hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
          >
            {deleting ? t("settings.delete.pending") : t("settings.delete.button")}
          </button>
        </section>
      </div>

      {confirming && <ConfirmDialog
        title={t("settings.delete.confirmTitle")}
        danger
        confirmLabel={t("settings.delete.button")}
        cancelLabel={t("common.cancel")}
        body={
          <>
            <p>
              {t("settings.delete.confirmBody")}
            </p>
            {reauthKind === "password" && (
              <label className="mt-4 block">
                <span className="mb-1.5 block text-sm font-semibold text-slate-700">{t("settings.delete.passwordLabel")}</span>
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                  className="min-h-12 w-full rounded-xl border border-slate-200 bg-stone-50 px-3 text-base font-medium outline-none focus:border-teal-600 focus:bg-white focus:ring-2 focus:ring-teal-600/15"
                />
              </label>
            )}
          </>
        }
        onConfirm={() => void handleConfirmDelete()}
        onCancel={() => {
          setConfirming(false);
          setPassword("");
        }}
      />}
    </main>
  );
}
