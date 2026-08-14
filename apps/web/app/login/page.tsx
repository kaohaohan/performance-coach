"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { apiFetch, ApiError } from "@/lib/api";

// Maps Firebase Auth error codes to a user-visible message. Never surfaces
// raw Firebase error text, and does not distinguish "no such user" from
// "wrong password" (avoids account enumeration).
function loginErrorMessage(err: unknown): string {
  const code = (err as { code?: string })?.code;
  switch (code) {
    case "auth/invalid-email":
      return "Enter a valid email address.";
    case "auth/invalid-credential":
    case "auth/user-not-found":
    case "auth/wrong-password":
      return "Incorrect email or password.";
    case "auth/too-many-requests":
      return "Too many attempts. Try again later.";
    default:
      return "Sign in failed. Please try again.";
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

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const token = await signIn(email, password);

      let me: Me;
      try {
        me = await apiFetch<Me>(token, "/api/v1/me");
      } catch {
        // Covers network failure and ApiError alike — don't expose
        // backend/internal details, just fail sign-in visibly.
        setError("Sign in failed. Please try again.");
        return;
      }

      if (me.role === "COACH") {
        router.replace("/coach/calendar");
      } else if (me.role === "ATHLETE") {
        router.replace("/today");
      } else {
        setError("Sign in failed. Please try again.");
      }
    } catch (err) {
      if (err instanceof ApiError) {
        setError("Sign in failed. Please try again.");
      } else {
        setError(loginErrorMessage(err));
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex flex-1 items-center justify-center px-4">
      <form
        onSubmit={handleSubmit}
        className="flex w-full max-w-sm flex-col gap-4"
      >
        <h1 className="text-xl font-semibold">Coach Login</h1>

        <label className="flex flex-col gap-1 text-sm">
          Email
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="rounded border border-black/20 px-3 py-2 dark:border-white/20"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Password
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="rounded border border-black/20 px-3 py-2 dark:border-white/20"
          />
        </label>

        {error && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="rounded bg-foreground px-4 py-2 text-background disabled:opacity-50"
        >
          {submitting ? "Signing in…" : "Sign In"}
        </button>
      </form>
    </main>
  );
}
