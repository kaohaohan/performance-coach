"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { apiFetch, ApiError } from "@/lib/api";
import { AuthDivider, GoogleSignInButton, googleAuthErrorMessage } from "@/components/google-sign-in-button";
import { AuthHero } from "@/components/auth-hero";

function loginErrorMessage(err: unknown): string {
  const code = (err as { code?: string })?.code;
  switch (code) {
    case "auth/invalid-email": return "Enter a valid email address.";
    case "auth/invalid-credential":
    case "auth/user-not-found":
    case "auth/wrong-password": return "Incorrect email or password.";
    case "auth/too-many-requests": return "Too many attempts. Try again later.";
    default: return "Sign in failed. Please try again.";
  }
}

type Me = { id: string; name: string; role: "COACH" | "ATHLETE" };

export default function LoginPage() {
  const router = useRouter();
  const { signIn, signInWithGoogle } = useAuth();
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
        setError("Sign in failed. Please try again.");
      }
      return;
    }
    if (me.role === "COACH") router.replace("/coach/calendar");
    else if (me.role === "ATHLETE") router.replace("/today");
    else setError("Sign in failed. Please try again.");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNoAccount(false);
    setSubmitting(true);
    try {
      await routeBySignedInRole(await signIn(email, password));
    } catch (err) {
      setError(err instanceof ApiError ? "Sign in failed. Please try again." : loginErrorMessage(err));
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
      const message = googleAuthErrorMessage(err);
      if (message) setError(message);
    } finally {
      setGooglePending(false);
    }
  }

  const busy = submitting || googlePending;

  return (
    <main className="min-h-screen bg-stone-100 text-slate-900">
      <AuthHero>
        <h1 className="mt-6 text-4xl font-semibold tracking-tight">Train.<br />Track. Improve.</h1>
        <p className="mt-4 max-w-xs text-base leading-7 text-slate-300">A focused training space for coaches and athletes.</p>
      </AuthHero>
      <div className="mx-auto -mt-8 max-w-sm px-4 pb-[max(2rem,env(safe-area-inset-bottom))]">
        <form onSubmit={handleSubmit} className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-950/5">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Coach &amp; Athlete Training</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight">Sign in</h2>

          <div className="mt-6">
            <GoogleSignInButton onClick={handleGoogleSignIn} pending={googlePending} disabled={submitting} />
          </div>
          <AuthDivider />

          <div className="grid gap-4">
            <label><span className="mb-1.5 block text-sm font-semibold text-slate-700">Email</span><input type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} className="min-h-14 w-full rounded-xl border border-slate-200 bg-stone-50 px-4 text-base outline-none focus:border-teal-600 focus:bg-white focus:ring-2 focus:ring-teal-600/15" /></label>
            <label><span className="mb-1.5 block text-sm font-semibold text-slate-700">Password</span><input type="password" required autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} className="min-h-14 w-full rounded-xl border border-slate-200 bg-stone-50 px-4 text-base outline-none focus:border-teal-600 focus:bg-white focus:ring-2 focus:ring-teal-600/15" /></label>
          </div>
          {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 px-3 py-2.5 text-sm font-medium text-red-700">{error}</p>}
          {noAccount && (
            <p role="alert" className="mt-4 rounded-xl bg-red-50 px-3 py-2.5 text-sm leading-6 font-medium text-red-700">
              We couldn&apos;t find an account for that sign-in. Joining a coach? <Link href="/join" className="underline">Use your invite code</Link>. Coaching? <Link href="/coach/signup" className="underline">Create a Coach account</Link>.
            </p>
          )}
          <button type="submit" disabled={busy} className="mt-6 min-h-14 w-full rounded-2xl bg-teal-600 px-5 text-base font-bold text-white shadow-sm transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500">{submitting ? "Signing in…" : "Sign In"}</button>
        </form>
        <Link href="/coach/signup" className="mt-4 flex min-h-14 w-full items-center justify-center rounded-2xl border border-slate-200 bg-white text-base font-bold text-slate-900 shadow-sm transition hover:bg-stone-50">Create Coach Account</Link>
        <p className="mt-5 text-center text-sm text-slate-600">
          Have an invite code? <Link href="/join" className="font-bold text-teal-700 hover:text-teal-800">Join a coach</Link>
        </p>
      </div>
    </main>
  );
}
