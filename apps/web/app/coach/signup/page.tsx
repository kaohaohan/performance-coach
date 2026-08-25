"use client";

// Self-service Coach registration: authenticate with Firebase (email/password
// or Google) -> fresh ID token -> POST /api/v1/coach-signup -> redirect
// /coach/calendar. This is the normal way to become a coach now — no manual
// bootstrap step, no role picker (this page only ever provisions COACH;
// athletes never see it and continue entering through invite codes,
// app/join). The request body carries a name and nothing else: the Firebase
// UID comes from the verified token server-side and the role is hard-coded
// there, so neither is ever sent from here.
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { apiFetch, ApiError } from "@/lib/api";
import { getFirebaseAuth } from "@/lib/firebase";
import { AuthDivider, GoogleSignInButton, googleAuthErrorMessage } from "@/components/google-sign-in-button";
import { AuthHero } from "@/components/auth-hero";

type Me = { id: string; name: string; role: "COACH" | "ATHLETE" };

// Same code -> copy mapping as app/login/page.tsx's loginErrorMessage,
// extended with the signup-specific codes this flow can also hit (mirrors
// app/join/[code]/page.tsx's firebaseAuthErrorMessage).
function firebaseAuthErrorMessage(err: unknown): string {
  const code = (err as { code?: string })?.code;
  switch (code) {
    case "auth/email-already-in-use": return "An account with that email already exists. Try signing in instead.";
    case "auth/invalid-email": return "Enter a valid email address.";
    case "auth/weak-password": return "Password must be at least 8 characters.";
    case "auth/too-many-requests": return "Too many attempts. Try again later.";
    default: return "Something went wrong. Please try again.";
  }
}

// provisioningErrorMessage covers the /coach-signup responses worth naming.
// 409 is the one an athlete can actually trigger by trying to sign up as a
// coach with an identity that already redeemed an invite — the backend
// never promotes ATHLETE to COACH, and this explains that rather than
// showing a bare conflict.
function provisioningErrorMessage(err: unknown): string {
  if (err instanceof ApiError && err.status === 409) {
    return "That account is already registered as an athlete. Sign in instead, or use a different account.";
  }
  return err instanceof ApiError
    ? `Your account was created, but we couldn't finish setting it up: ${err.message}`
    : "Your account was created, but we couldn't finish setting it up. Please try again.";
}

export default function CoachSignupPage() {
  const router = useRouter();
  const { signUp, signInWithGoogle, signOut } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [googlePending, setGooglePending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Firebase account creation succeeded but backend provisioning failed —
  // a real (if unusual) split-failure state, not a case to paper over: we
  // never claim signup succeeded when the coach has no PostgreSQL `users`
  // row yet. Retrying re-POSTs /coach-signup for the same Firebase
  // account without creating a second one (Signup is idempotent on an
  // existing COACH row).
  const [provisioningFailed, setProvisioningFailed] = useState(false);
  // Google authentication has completed and this Firebase identity is now
  // signed in, but no COACH row exists yet. The card switches to confirming
  // the name athletes will see — the backend requires one when it creates
  // the row, Google's displayName is a reasonable default rather than an
  // authority on what a coach wants to be called, and Google does not
  // always supply one at all.
  const [googleConfirm, setGoogleConfirm] = useState(false);

  async function provisionCoach(token: string, coachName: string) {
    const me = await apiFetch<Me>(token, "/api/v1/coach-signup", {
      method: "POST",
      body: { name: coachName },
    });
    if (me.role !== "COACH") {
      // Should be unreachable — the endpoint hard-codes role server-side
      // — but never redirect into the Coach dashboard on an unexpected
      // response.
      throw new Error("unexpected role in coach-signup response");
    }
    router.replace("/coach/calendar");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setProvisioningFailed(false);
    setSubmitting(true);
    try {
      const token = await signUp(email, password);
      try {
        await provisionCoach(token, name.trim());
      } catch (err) {
        // Firebase account already exists at this point — do not pretend
        // signup succeeded. Surface an actionable error and let the coach
        // retry provisioning without re-entering credentials.
        setProvisioningFailed(true);
        setError(provisioningErrorMessage(err));
      }
    } catch (err) {
      setError(firebaseAuthErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleGoogleSignIn() {
    setError(null);
    setProvisioningFailed(false);
    setGooglePending(true);
    try {
      const { user } = await signInWithGoogle();
      // Pre-fill from Google, but never overwrite something already typed.
      if (!name.trim() && user.displayName) setName(user.displayName);
      setGoogleConfirm(true);
    } catch (err) {
      const message = googleAuthErrorMessage(err);
      if (message) setError(message);
    } finally {
      setGooglePending(false);
    }
  }

  // handleGoogleConfirm provisions the COACH row for the Google identity
  // already signed in. The token is minted fresh from the current Firebase
  // user rather than reusing the one signInWithGoogle returned, so a coach
  // who pauses on the name field cannot submit a stale token.
  async function handleGoogleConfirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const coachName = name.trim();
    if (!coachName) {
      setError("Enter the name your athletes will see.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const currentUser = getFirebaseAuth().currentUser;
      if (!currentUser) {
        setGoogleConfirm(false);
        setError("Your session expired. Please sign in again.");
        return;
      }
      await provisionCoach(await currentUser.getIdToken(), coachName);
    } catch (err) {
      setError(provisioningErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  // Escape hatch for picking the wrong Google account: sign the identity
  // back out so the next attempt starts from Google's account chooser
  // rather than silently reusing it.
  async function handleUseDifferentAccount() {
    setError(null);
    setGoogleConfirm(false);
    setName("");
    try {
      await signOut();
    } catch {
      // Already signed out, or Firebase is unreachable — the next Google
      // click still re-prompts (prompt=select_account), so there is nothing
      // actionable to show here.
    }
  }

  async function handleRetryProvisioning() {
    setError(null);
    setSubmitting(true);
    try {
      const currentUser = getFirebaseAuth().currentUser;
      if (!currentUser) {
        // Session didn't persist (e.g. page reload) — nothing to retry
        // with; the coach has to sign in normally instead.
        setError("Your session expired. Please sign in instead.");
        setProvisioningFailed(false);
        return;
      }
      const token = await currentUser.getIdToken(true);
      await provisionCoach(token, name.trim());
    } catch (err) {
      setError(
        err instanceof ApiError
          ? `We still couldn't finish setting up your account: ${err.message}`
          : "We still couldn't finish setting up your account. Please try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-stone-100 text-slate-900">
      <AuthHero>
        <h1 className="mt-6 text-4xl font-semibold tracking-tight">Build your<br />coaching practice.</h1>
        <p className="mt-4 max-w-xs text-base leading-7 text-slate-300">Create your Coach account to start programming and inviting athletes.</p>
      </AuthHero>
      <div className="mx-auto -mt-8 max-w-sm px-4 pb-[max(2rem,env(safe-area-inset-bottom))]">
        <form onSubmit={googleConfirm ? handleGoogleConfirm : handleSubmit} className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-950/5">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Coach &amp; Athlete Training</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight">{googleConfirm ? "Confirm your name" : "Create Coach Account"}</h2>

          {googleConfirm ? (
            <p className="mt-2 text-sm leading-6 text-slate-600">You&apos;re signed in with Google. This is the name your athletes will see.</p>
          ) : (
            <>
              <div className="mt-6">
                <GoogleSignInButton onClick={handleGoogleSignIn} pending={googlePending} disabled={submitting || provisioningFailed} />
              </div>
              <AuthDivider />
            </>
          )}

          <div className={googleConfirm ? "mt-6 grid gap-4" : "grid gap-4"}>
            <label>
              <span className="mb-1.5 block text-sm font-semibold text-slate-700">Name</span>
              <input type="text" required autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} maxLength={80} disabled={provisioningFailed} className="min-h-14 w-full rounded-xl border border-slate-200 bg-stone-50 px-4 text-base outline-none focus:border-teal-600 focus:bg-white focus:ring-2 focus:ring-teal-600/15 disabled:opacity-60" />
            </label>
            {!googleConfirm && (
              <>
                <label>
                  <span className="mb-1.5 block text-sm font-semibold text-slate-700">Email</span>
                  <input type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} disabled={provisioningFailed} className="min-h-14 w-full rounded-xl border border-slate-200 bg-stone-50 px-4 text-base outline-none focus:border-teal-600 focus:bg-white focus:ring-2 focus:ring-teal-600/15 disabled:opacity-60" />
                </label>
                <label>
                  <span className="mb-1.5 block text-sm font-semibold text-slate-700">Password</span>
                  <input type="password" required minLength={8} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} disabled={provisioningFailed} className="min-h-14 w-full rounded-xl border border-slate-200 bg-stone-50 px-4 text-base outline-none focus:border-teal-600 focus:bg-white focus:ring-2 focus:ring-teal-600/15 disabled:opacity-60" />
                </label>
              </>
            )}
          </div>

          {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 px-3 py-2.5 text-sm font-medium text-red-700">{error}</p>}

          {provisioningFailed ? (
            <button type="button" onClick={handleRetryProvisioning} disabled={submitting} className="mt-6 min-h-14 w-full rounded-2xl bg-teal-600 px-5 text-base font-bold text-white shadow-sm transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500">{submitting ? "Retrying…" : "Retry account setup"}</button>
          ) : (
            <button type="submit" disabled={submitting || googlePending} className="mt-6 min-h-14 w-full rounded-2xl bg-teal-600 px-5 text-base font-bold text-white shadow-sm transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500">{submitting ? "Creating account…" : "Create Coach Account"}</button>
          )}

          {googleConfirm && (
            <button type="button" onClick={handleUseDifferentAccount} disabled={submitting} className="mt-3 min-h-11 w-full text-sm font-bold text-slate-600 transition hover:text-slate-900 disabled:text-slate-300">Use a different account</button>
          )}
        </form>
        <p className="mt-5 text-center text-sm text-slate-600">
          Already have an account? <Link href="/login" className="font-bold text-teal-700 hover:text-teal-800">Sign in</Link>
        </p>
      </div>
    </main>
  );
}
