"use client";

// Self-service Coach registration: createUserWithEmailAndPassword -> fresh
// ID token -> POST /api/v1/coach-signup -> redirect /coach/calendar. This
// is the normal way to become a coach now — no manual bootstrap step, no
// role picker (this page only ever provisions COACH; athletes never see
// it and continue entering through invite codes, app/join).
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { apiFetch, ApiError } from "@/lib/api";
import { getFirebaseAuth } from "@/lib/firebase";

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

export default function CoachSignupPage() {
  const router = useRouter();
  const { signUp } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Firebase account creation succeeded but backend provisioning failed —
  // a real (if unusual) split-failure state, not a case to paper over: we
  // never claim signup succeeded when the coach has no PostgreSQL `users`
  // row yet. Retrying re-POSTs /coach-signup for the same Firebase
  // account without creating a second one (Signup is idempotent on an
  // existing COACH row).
  const [provisioningFailed, setProvisioningFailed] = useState(false);

  async function provisionCoach(token: string) {
    const me = await apiFetch<Me>(token, "/api/v1/coach-signup", {
      method: "POST",
      body: { name: name.trim() },
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
        await provisionCoach(token);
      } catch (err) {
        // Firebase account already exists at this point — do not pretend
        // signup succeeded. Surface an actionable error and let the coach
        // retry provisioning without re-entering credentials.
        setProvisioningFailed(true);
        setError(
          err instanceof ApiError
            ? `Your account was created, but we couldn't finish setting it up: ${err.message}`
            : "Your account was created, but we couldn't finish setting it up. Please try again.",
        );
      }
    } catch (err) {
      setError(firebaseAuthErrorMessage(err));
    } finally {
      setSubmitting(false);
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
      await provisionCoach(token);
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
      <section className="bg-slate-950 px-6 pb-20 pt-[max(2.5rem,env(safe-area-inset-top))] text-white">
        <div className="mx-auto max-w-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-teal-300">Performance Coach</p>
          <h1 className="mt-6 text-4xl font-semibold tracking-tight">Build your<br />coaching practice.</h1>
          <p className="mt-4 max-w-xs text-base leading-7 text-slate-300">Create your Coach account to start programming and inviting athletes.</p>
        </div>
      </section>
      <div className="mx-auto -mt-8 max-w-sm px-4 pb-[max(2rem,env(safe-area-inset-bottom))]">
        <form onSubmit={handleSubmit} className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-950/5">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Coach &amp; Athlete Training</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight">Create Coach Account</h2>
          <div className="mt-6 grid gap-4">
            <label>
              <span className="mb-1.5 block text-sm font-semibold text-slate-700">Name</span>
              <input type="text" required autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} maxLength={80} disabled={provisioningFailed} className="min-h-14 w-full rounded-xl border border-slate-200 bg-stone-50 px-4 text-base outline-none focus:border-teal-600 focus:bg-white focus:ring-2 focus:ring-teal-600/15 disabled:opacity-60" />
            </label>
            <label>
              <span className="mb-1.5 block text-sm font-semibold text-slate-700">Email</span>
              <input type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} disabled={provisioningFailed} className="min-h-14 w-full rounded-xl border border-slate-200 bg-stone-50 px-4 text-base outline-none focus:border-teal-600 focus:bg-white focus:ring-2 focus:ring-teal-600/15 disabled:opacity-60" />
            </label>
            <label>
              <span className="mb-1.5 block text-sm font-semibold text-slate-700">Password</span>
              <input type="password" required minLength={8} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} disabled={provisioningFailed} className="min-h-14 w-full rounded-xl border border-slate-200 bg-stone-50 px-4 text-base outline-none focus:border-teal-600 focus:bg-white focus:ring-2 focus:ring-teal-600/15 disabled:opacity-60" />
            </label>
          </div>
          {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 px-3 py-2.5 text-sm font-medium text-red-700">{error}</p>}
          {provisioningFailed ? (
            <button type="button" onClick={handleRetryProvisioning} disabled={submitting} className="mt-6 min-h-14 w-full rounded-2xl bg-teal-600 px-5 text-base font-bold text-white shadow-sm transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500">{submitting ? "Retrying…" : "Retry account setup"}</button>
          ) : (
            <button type="submit" disabled={submitting} className="mt-6 min-h-14 w-full rounded-2xl bg-teal-600 px-5 text-base font-bold text-white shadow-sm transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500">{submitting ? "Creating account…" : "Create Coach Account"}</button>
          )}
        </form>
        <p className="mt-5 text-center text-sm text-slate-600">
          Already have an account? <Link href="/login" className="font-bold text-teal-700 hover:text-teal-800">Sign in</Link>
        </p>
      </div>
    </main>
  );
}
