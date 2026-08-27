"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { apiFetch, ApiError } from "@/lib/api";
import { ConfirmDialog } from "@/components/confirm-dialog";
import SignOutButton from "@/components/sign-out-button";
import { AppHeader } from "@/components/app-header";
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

function errorMessage(err: unknown): string {
  return err instanceof ApiError ? err.message : "Something went wrong. Please try again.";
}

export default function SettingsPage() {
  const router = useRouter();
  const { user, idToken, loading: authLoading } = useAuth();
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
        if (!cancelled) setLoadError(errorMessage(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [idToken]);

  const reauthKind = user
    ? deletionReauthKind(providerIds(user), Capacitor.isNativePlatform())
    : "unsupported";

  async function handleConfirmDelete() {
    if (deleting) return;
    if (reauthKind === "password" && password.trim() === "") {
      setDeleteError("Enter your password to delete your account.");
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
      const message = err instanceof AccountDeletionError
        ? err.message
        : "Couldn't delete your account. Check your connection and try again.";
      setDeleteError(message);
      setDeleting(false);
    }
  }

  if (authLoading || (user && !idToken)) return <main className="min-h-screen bg-stone-100 p-6 text-slate-700">Loading…</main>;
  if (!user) return null;

  const exitHref = me ? settingsExitHref(me.role) : "/login";

  return (
    <main className="min-h-screen bg-stone-100 pb-[max(2rem,env(safe-area-inset-bottom))] text-slate-900">
      <AppHeader
        actions={<SignOutButton className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400 transition hover:text-white disabled:opacity-50" />}
      >
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">Account</h1>
        <p className="mt-2 text-sm text-slate-300">Your PumpLoop account.</p>
        <button
          type="button"
          onClick={() => router.push(exitHref)}
          className="mt-4 min-h-11 rounded-xl border border-slate-600 px-4 text-sm font-bold text-white transition hover:border-slate-400 hover:bg-slate-900"
        >
          {me?.role === "ATHLETE" ? "← Today" : "← Coach Calendar"}
        </button>
      </AppHeader>

      <div className="mx-auto -mt-3 flex max-w-lg flex-col gap-4 px-4">
        {loadError && <p role="alert" className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700 ring-1 ring-red-600/10">{loadError}</p>}
        {deleteError && <p role="alert" className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700 ring-1 ring-red-600/10">{deleteError}</p>}

        <section className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-950/5">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">Signed in as</p>
          <p className="mt-2 text-lg font-semibold">{me?.name ?? "…"}</p>
          {me && <p className="mt-1 text-sm font-medium text-slate-500">{me.role === "COACH" ? "Coach" : "Athlete"}</p>}
        </section>

        <section className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-red-600/10">
          <h2 className="text-lg font-semibold tracking-tight">Delete account</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            This permanently removes your ability to sign in. Your name and personal account details are removed. Training history your coach or athletes already share with you may remain in anonymized form.
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
            {deleting ? "Deleting account…" : "Delete Account"}
          </button>
        </section>
      </div>

      {confirming && <ConfirmDialog
        title="Delete your account?"
        danger
        confirmLabel="Delete Account"
        cancelLabel="Cancel"
        body={
          <>
            <p>
              You will no longer be able to sign in. Your personal account identity will be removed. Legitimate training records already shared with your coach or athletes may remain in anonymized form.
            </p>
            {reauthKind === "password" && (
              <label className="mt-4 block">
                <span className="mb-1.5 block text-sm font-semibold text-slate-700">Password</span>
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
