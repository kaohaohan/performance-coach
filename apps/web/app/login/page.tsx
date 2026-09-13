"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { apiFetch, ApiError } from "@/lib/api";
import { AuthDivider, GoogleSignInButton } from "@/components/google-sign-in-button";
import { AuthHero } from "@/components/auth-hero";
import { AppleSignInButton } from "@/components/apple-sign-in-button";
import { useT } from "@/lib/i18n";
import {
  APPLE_AUTH_POLICY,
  GOOGLE_AUTH_POLICY,
  PASSWORD_AUTH_CODES,
  errorMessage,
  type ErrorPolicy,
} from "@/lib/i18n/errors";

// This form authenticates with an email and a password, so it opts into
// PASSWORD_AUTH_CODES — the table that turns auth/invalid-credential into
// "Incorrect email or password". That table is deliberately not global:
// the same code on the Google popup means something else entirely, which is
// why GOOGLE_AUTH_POLICY below does not carry it (lib/i18n/errors.ts).
//
// An ApiError reaching this policy has already been handled by the caller
// (routeBySignedInRole owns the /me 401), so there is no serverMessage
// passthrough here — anything unexpected reads as a failed sign-in.
const LOGIN_AUTH_POLICY: ErrorPolicy = {
  codes: { ...PASSWORD_AUTH_CODES },
  fallback: "errors.auth.signInFailed",
};

type Me = { id: string; name: string; role: "COACH" | "ATHLETE" };

export default function LoginPage() {
  const router = useRouter();
  const t = useT();
  const { signIn, signInWithGoogle, signInWithApple } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  // A verified Firebase sign-in with no PostgreSQL `users` row is reachable
  // now that /join/[code] lets athletes create Firebase accounts without
  // necessarily having redeemed an invite yet — point them at /join
  // instead of the old dead-end generic error
  // (docs/athlete-onboarding-invite-codes-v0.1.md §7.7). Google sign-in
  // reaches it too: a Google identity nobody has onboarded yet is exactly
  // this state, and login is deliberately not allowed to provision it.
  const [noAccount, setNoAccount] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [googlePending, setGooglePending] = useState(false);
  const [applePending, setApplePending] = useState(false);

  // routeBySignedInRole is the only thing login does after authentication:
  // ask the API who this verified Firebase identity already is, and route.
  // It never creates an application user — role provisioning belongs to the
  // invite flow (ATHLETE) and /coach/signup (COACH), both of which
  // hard-code the role server-side.
  async function routeBySignedInRole(token: string) {
    let me: Me;
    try {
      me = await apiFetch<Me>(token, "/api/v1/me");
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setNoAccount(true);
      } else {
        setError(t("errors.auth.signInFailed"));
      }
      return;
    }
    if (me.role === "COACH") router.replace("/coach/calendar");
    else if (me.role === "ATHLETE") router.replace("/today");
    else setError(t("errors.auth.signInFailed"));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNoAccount(false);
    setSubmitting(true);
    try {
      await routeBySignedInRole(await signIn(email, password));
    } catch (err) {
      setError(errorMessage(t, err, LOGIN_AUTH_POLICY));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleGoogleSignIn() {
    setError(null);
    setNoAccount(false);
    setGooglePending(true);
    try {
      const { idToken } = await signInWithGoogle();
      await routeBySignedInRole(idToken);
    } catch (err) {
      // null means the person dismissed the Google chooser — not an error
      // worth shouting about.
      const message = errorMessage(t, err, GOOGLE_AUTH_POLICY);
      if (message) setError(message);
    } finally {
      setGooglePending(false);
    }
  }

  // handleAppleSignIn is identical to handleGoogleSignIn after
  // authentication — both converge on routeBySignedInRole, and login never
  // provisions. Apple renders only in the iOS shell; on web the button is
  // null and this handler is unreachable.
  async function handleAppleSignIn() {
    setError(null);
    setNoAccount(false);
    setApplePending(true);
    try {
      const { idToken } = await signInWithApple();
      await routeBySignedInRole(idToken);
    } catch (err) {
      // null means the person dismissed the Apple sheet — not an error
      // worth shouting about.
      const message = errorMessage(t, err, APPLE_AUTH_POLICY);
      if (message) setError(message);
    } finally {
      setApplePending(false);
    }
  }

  const busy = submitting || googlePending || applePending;

  return (
    <main className="min-h-screen bg-stone-100 text-slate-900">
      <AuthHero>
        <h1 className="mt-6 text-4xl font-semibold tracking-tight">{t("auth.login.heroTitleLine1")}<br />{t("auth.login.heroTitleLine2")}</h1>
        <p className="mt-4 max-w-xs text-base leading-7 text-slate-300">{t("auth.login.heroSubtitle")}</p>
      </AuthHero>
      <div className="mx-auto -mt-8 max-w-sm px-4 pb-[max(2rem,env(safe-area-inset-bottom))]">
        <form onSubmit={handleSubmit} className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-950/5">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{t("auth.eyebrow")}</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight">{t("auth.login.heading")}</h2>

          <div className="mt-6 grid gap-3">
            {/* Apple first on iOS: HIG placement for the option Guideline
                4.8 requires at equivalent prominence to Google. Null on
                web, so the grid collapses to the Google button there. */}
            <AppleSignInButton onClick={handleAppleSignIn} pending={applePending} disabled={submitting || googlePending} />
            <GoogleSignInButton onClick={handleGoogleSignIn} pending={googlePending} disabled={submitting || applePending} />
          </div>
          <AuthDivider />

          <div className="grid gap-4">
            <label><span className="mb-1.5 block text-sm font-semibold text-slate-700">{t("auth.field.email")}</span><input type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} className="min-h-14 w-full rounded-xl border border-slate-200 bg-stone-50 px-4 text-base outline-none focus:border-teal-600 focus:bg-white focus:ring-2 focus:ring-teal-600/15" /></label>
            <label><span className="mb-1.5 block text-sm font-semibold text-slate-700">{t("auth.field.password")}</span><input type="password" required autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} className="min-h-14 w-full rounded-xl border border-slate-200 bg-stone-50 px-4 text-base outline-none focus:border-teal-600 focus:bg-white focus:ring-2 focus:ring-teal-600/15" /></label>
          </div>
          {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 px-3 py-2.5 text-sm font-medium text-red-700">{error}</p>}
          {noAccount && (
            <p role="alert" className="mt-4 rounded-xl bg-red-50 px-3 py-2.5 text-sm leading-6 font-medium text-red-700">
              {/* Split at the two links rather than interpolated: a <Link>
                  is not a string, and burying markup in a translated
                  sentence is how a locale loses the ability to move it. */}
              {t("auth.login.noAccount.intro")} {t("auth.login.noAccount.joinPrompt")}{" "}
              <Link href="/join" className="underline">{t("auth.login.noAccount.joinLink")}</Link>{" "}
              {t("auth.login.noAccount.coachPrompt")}{" "}
              <Link href="/coach/signup" className="underline">{t("auth.login.noAccount.coachLink")}</Link>
            </p>
          )}
          <button type="submit" disabled={busy} className="mt-6 min-h-14 w-full rounded-2xl bg-teal-600 px-5 text-base font-bold text-white shadow-sm transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500">{submitting ? t("auth.login.submitting") : t("auth.login.submit")}</button>
        </form>
        <Link href="/coach/signup" className="mt-4 flex min-h-14 w-full items-center justify-center rounded-2xl border border-slate-200 bg-white text-base font-bold text-slate-900 shadow-sm transition hover:bg-stone-50">{t("auth.createCoachAccount")}</Link>
        <p className="mt-5 text-center text-sm text-slate-600">
          {t("auth.login.inviteHint")} <Link href="/join" className="font-bold text-teal-700 hover:text-teal-800">{t("auth.login.inviteLink")}</Link>
        </p>
      </div>
    </main>
  );
}
