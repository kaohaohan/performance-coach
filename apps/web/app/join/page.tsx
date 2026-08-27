"use client";

// Manual invite-code entry (docs/athlete-onboarding-invite-codes-v0.1.md
// §7.5). Unauthenticated — this route, /join/[code], and /login's "Have an
// invite code?" link are the only ways in.
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AuthHero } from "@/components/auth-hero";

// normalizeInput mirrors the server's canonical-form normalizer
// (apps/api/internal/invitecode/code.go Normalize): uppercase, strip
// hyphens/whitespace, map the visually ambiguous I/L -> 1 and O -> 0. This
// is display/UX polish only — the server re-normalizes and validates the
// code on preview/redeem regardless of what this produces.
function normalizeInput(raw: string): string {
  let out = "";
  for (const ch of raw) {
    if (ch === "-" || ch === " " || ch === "\t") continue;
    if (ch === "i" || ch === "I" || ch === "l" || ch === "L") { out += "1"; continue; }
    if (ch === "o" || ch === "O") { out += "0"; continue; }
    out += ch.toUpperCase();
  }
  return out;
}

export default function JoinPage() {
  const router = useRouter();
  const [code, setCode] = useState("");

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = normalizeInput(code);
    if (normalized === "") return;
    router.push(`/join/${encodeURIComponent(normalized)}`);
  }

  return (
    <main className="min-h-screen bg-stone-100 text-slate-900">
      <AuthHero padding="pb-16">
        <h1 className="mt-6 text-4xl font-semibold tracking-tight">Join your coach.</h1>
        <p className="mt-4 max-w-xs text-base leading-7 text-slate-300">Enter the code your coach sent you.</p>
      </AuthHero>

      <div className="mx-auto -mt-8 max-w-sm px-4 pb-[max(2rem,env(safe-area-inset-bottom))]">
        <form onSubmit={handleSubmit} className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-950/5">
          <label>
            <span className="mb-1.5 block text-sm font-semibold text-slate-700">Join code</span>
            <input
              type="text"
              inputMode="text"
              autoCapitalize="characters"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="XXXXX-XXXXX"
              maxLength={16}
              className="min-h-14 w-full rounded-xl border border-slate-200 bg-stone-50 px-4 font-mono text-[20px] tracking-widest outline-none focus:border-teal-600 focus:bg-white focus:ring-2 focus:ring-teal-600/15"
            />
          </label>
          <button type="submit" disabled={normalizeInput(code) === ""} className="mt-6 min-h-14 w-full rounded-2xl bg-teal-600 px-5 text-base font-bold text-white shadow-sm transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500">Continue</button>
        </form>
        <p className="mt-5 text-center text-sm text-slate-600">
          Already have an account? <Link href="/login" className="font-bold text-teal-700 hover:text-teal-800">Sign in</Link>
        </p>
      </div>
    </main>
  );
}
