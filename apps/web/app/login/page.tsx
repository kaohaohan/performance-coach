"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { apiFetch, ApiError } from "@/lib/api";

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
  const { signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const token = await signIn(email, password);
      let me: Me;
      try {
        me = await apiFetch<Me>(token, "/api/v1/me");
      } catch {
        setError("Sign in failed. Please try again.");
        return;
      }
      if (me.role === "COACH") router.replace("/coach/calendar");
      else if (me.role === "ATHLETE") router.replace("/today");
      else setError("Sign in failed. Please try again.");
    } catch (err) {
      setError(err instanceof ApiError ? "Sign in failed. Please try again." : loginErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-stone-100 text-slate-900">
      <section className="bg-slate-950 px-6 pb-20 pt-[max(2.5rem,env(safe-area-inset-top))] text-white">
        <div className="mx-auto max-w-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-teal-300">Performance Coach</p>
          <h1 className="mt-6 text-4xl font-semibold tracking-tight">Train.<br />Track. Improve.</h1>
          <p className="mt-4 max-w-xs text-base leading-7 text-slate-300">A focused training space for coaches and athletes.</p>
        </div>
      </section>
      <div className="mx-auto -mt-8 max-w-sm px-4 pb-[max(2rem,env(safe-area-inset-bottom))]">
        <form onSubmit={handleSubmit} className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-950/5">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Coach &amp; Athlete Training</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight">Sign in</h2>
          <div className="mt-6 grid gap-4">
            <label><span className="mb-1.5 block text-sm font-semibold text-slate-700">Email</span><input type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} className="min-h-14 w-full rounded-xl border border-slate-200 bg-stone-50 px-4 text-base outline-none focus:border-teal-600 focus:bg-white focus:ring-2 focus:ring-teal-600/15" /></label>
            <label><span className="mb-1.5 block text-sm font-semibold text-slate-700">Password</span><input type="password" required autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} className="min-h-14 w-full rounded-xl border border-slate-200 bg-stone-50 px-4 text-base outline-none focus:border-teal-600 focus:bg-white focus:ring-2 focus:ring-teal-600/15" /></label>
          </div>
          {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 px-3 py-2.5 text-sm font-medium text-red-700">{error}</p>}
          <button type="submit" disabled={submitting} className="mt-6 min-h-14 w-full rounded-2xl bg-teal-600 px-5 text-base font-bold text-white shadow-sm transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500">{submitting ? "Signing in…" : "Sign In"}</button>
        </form>
      </div>
    </main>
  );
}
