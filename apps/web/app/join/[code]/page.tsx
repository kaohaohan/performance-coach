"use client";

// Preview -> confirm -> auth -> redeem -> Today
// (docs/athlete-onboarding-invite-codes-v0.1.md §7.6). One route, one
// stepped local state machine — auth happens inline here, never a redirect
// to /login, which is what makes "login-return-to-invite" a non-problem.
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { ApiError, apiFetch, publicApiFetch } from "@/lib/api";

type Preview = { code: string; coachName: string; description: string | null };
type Redeemed = { user: { id: string; name: string; role: "ATHLETE" }; coach: { name: string } };
type Step = "loading" | "invalid" | "confirming" | "authenticating" | "redeeming" | "onboarded";

function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : "Something went wrong. Please try again.";
}

function initials(name: string): string {
  return name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
}

// firebaseAuthErrorMessage maps Firebase Auth's error codes to copy — same
// pattern as app/login/page.tsx's loginErrorMessage, extended with the
// signup-specific codes this flow can also hit.
function firebaseAuthErrorMessage(err: unknown): string {
  const code = (err as { code?: string })?.code;
  switch (code) {
    case "auth/email-already-in-use": return "An account with that email already exists. Try signing in instead.";
    case "auth/invalid-email": return "Enter a valid email address.";
    case "auth/weak-password": return "Password must be at least 8 characters.";
    case "auth/invalid-credential":
    case "auth/user-not-found":
    case "auth/wrong-password": return "Incorrect email or password.";
    case "auth/too-many-requests": return "Too many attempts. Try again later.";
    default: return "Something went wrong. Please try again.";
  }
}

export default function JoinCodePage() {
  const params = useParams<{ code: string }>();
  const code = params.code;
  const router = useRouter();
  const { idToken, loading: authLoading, signIn, signUp } = useAuth();

  const [step, setStep] = useState<Step>("loading");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [authMode, setAuthMode] = useState<"create" | "signin">("create");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [redeemError, setRedeemError] = useState<string | null>(null);
  const [redeemed, setRedeemed] = useState<Redeemed | null>(null);
  // A freshly minted Firebase ID token, taken directly from the sign-in /
  // sign-up credential (or from an already-live session) so redeem doesn't
  // have to race auth-context's async onIdTokenChanged update.
  const [freshToken, setFreshToken] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await publicApiFetch<Preview>(`/api/v1/invite-codes/${encodeURIComponent(code)}/preview`);
        if (!cancelled) {
          setPreview(result);
          setStep("confirming");
        }
      } catch {
        if (!cancelled) setStep("invalid");
      }
    })();
    return () => { cancelled = true; };
  }, [code]);

  async function runRedeem(token: string) {
    setStep("redeeming");
    setRedeemError(null);
    try {
      const result = await apiFetch<Redeemed>(token, `/api/v1/invite-codes/${encodeURIComponent(code)}/redeem`, {
        method: "POST",
        body: { name: name.trim() },
      });
      setRedeemed(result);
      setStep("onboarded");
    } catch (error) {
      setRedeemError(errorMessage(error));
      setStep("authenticating");
    }
  }

  // Already has a live Firebase session (e.g. resuming after abandoning
  // mid-flow, or signed in from another tab) — skip straight to redeem
  // instead of asking them to authenticate again
  // (docs/athlete-onboarding-invite-codes-v0.1.md §6, "Athlete abandons
  // after Firebase signup, before redeem").
  function handleContinue() {
    if (idToken) {
      setFreshToken(idToken);
      runRedeem(idToken);
      return;
    }
    setStep("authenticating");
  }

  function handleRetryRedeem() {
    const token = freshToken ?? idToken;
    if (token) runRedeem(token);
  }

  async function handleAuthSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (redeemError) {
      handleRetryRedeem();
      return;
    }
    setAuthSubmitting(true);
    setAuthError(null);
    try {
      const token = authMode === "create" ? await signUp(email, password) : await signIn(email, password);
      setFreshToken(token);
      await runRedeem(token);
    } catch (err) {
      setAuthError(firebaseAuthErrorMessage(err));
    } finally {
      setAuthSubmitting(false);
    }
  }

  if (step === "loading") {
    return (
      <JoinShell>
        <p className="text-sm font-medium text-slate-500">Checking your invite…</p>
      </JoinShell>
    );
  }

  if (step === "invalid") {
    return (
      <JoinShell>
        <h2 className="text-xl font-semibold tracking-tight">This code isn&apos;t valid.</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">It may have expired or been revoked. Ask your coach for a new link.</p>
        <button type="button" onClick={() => router.push("/join")} className="mt-6 min-h-14 w-full rounded-2xl bg-teal-600 px-5 text-base font-bold text-white shadow-sm transition hover:bg-teal-700">Enter another code</button>
      </JoinShell>
    );
  }

  if (!preview) return null;

  return (
    <JoinShell>
      <div className="flex items-center gap-3">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-slate-100 text-base font-bold text-slate-600">{initials(preview.coachName)}</span>
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">You&apos;re joining</p>
          <p className="truncate text-lg font-semibold text-slate-900">{preview.coachName}</p>
        </div>
      </div>
      {preview.description && <p className="mt-3 rounded-2xl bg-stone-50 px-4 py-3 text-sm leading-6 text-slate-600">{preview.description}</p>}

      {step === "confirming" && (
        <div className="mt-6 flex gap-3">
          <button type="button" onClick={() => router.push("/join")} className="min-h-14 flex-1 rounded-2xl border border-slate-200 text-base font-bold text-slate-700 transition hover:bg-stone-50">Use another code</button>
          <button type="button" onClick={handleContinue} disabled={authLoading} className="min-h-14 flex-1 rounded-2xl bg-teal-600 text-base font-bold text-white shadow-sm transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500">Continue</button>
        </div>
      )}

      {(step === "authenticating" || step === "redeeming") && (
        <div className="mt-6">
          <div className="flex gap-2" role="tablist" aria-label="Sign in or create account">
            <button type="button" role="tab" aria-selected={authMode === "create"} onClick={() => { setAuthMode("create"); setAuthError(null); }} className={`min-h-11 flex-1 rounded-xl text-sm font-bold transition ${authMode === "create" ? "bg-slate-950 text-white" : "bg-stone-100 text-slate-600 hover:bg-stone-200"}`}>Create account</button>
            <button type="button" role="tab" aria-selected={authMode === "signin"} onClick={() => { setAuthMode("signin"); setAuthError(null); }} className={`min-h-11 flex-1 rounded-xl text-sm font-bold transition ${authMode === "signin" ? "bg-slate-950 text-white" : "bg-stone-100 text-slate-600 hover:bg-stone-200"}`}>Sign in</button>
          </div>

          <form onSubmit={handleAuthSubmit} className="mt-4 grid gap-4">
            {authMode === "create" && (
              <label>
                <span className="mb-1.5 block text-sm font-semibold text-slate-700">Name</span>
                <input type="text" required autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} maxLength={80} className="min-h-14 w-full rounded-xl border border-slate-200 bg-stone-50 px-4 text-base outline-none focus:border-teal-600 focus:bg-white focus:ring-2 focus:ring-teal-600/15" />
              </label>
            )}
            <label>
              <span className="mb-1.5 block text-sm font-semibold text-slate-700">Email</span>
              <input type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} className="min-h-14 w-full rounded-xl border border-slate-200 bg-stone-50 px-4 text-base outline-none focus:border-teal-600 focus:bg-white focus:ring-2 focus:ring-teal-600/15" />
            </label>
            <label>
              <span className="mb-1.5 block text-sm font-semibold text-slate-700">Password</span>
              <input type="password" required minLength={authMode === "create" ? 8 : undefined} autoComplete={authMode === "create" ? "new-password" : "current-password"} value={password} onChange={(event) => setPassword(event.target.value)} className="min-h-14 w-full rounded-xl border border-slate-200 bg-stone-50 px-4 text-base outline-none focus:border-teal-600 focus:bg-white focus:ring-2 focus:ring-teal-600/15" />
            </label>

            {(authError || redeemError) && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2.5 text-sm font-medium text-red-700">{authError ?? redeemError}</p>}

            <button type="submit" disabled={authSubmitting || step === "redeeming"} className="min-h-14 w-full rounded-2xl bg-teal-600 px-5 text-base font-bold text-white shadow-sm transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500">
              {step === "redeeming" ? "Connecting…" : redeemError ? "Try again" : authSubmitting ? (authMode === "create" ? "Creating account…" : "Signing in…") : authMode === "create" ? "Create account" : "Sign in"}
            </button>
          </form>
        </div>
      )}

      {step === "onboarded" && redeemed && (
        <div className="mt-6">
          <p className="text-base font-semibold text-slate-900">You&apos;re connected to {redeemed.coach.name}.</p>
          <p className="mt-1 text-sm text-slate-500">Taking you to your training…</p>
          <RedirectToToday />
        </div>
      )}
    </JoinShell>
  );
}

function RedirectToToday() {
  const router = useRouter();
  useEffect(() => {
    // replace, not push — back from Today must not land back in the join
    // flow (docs/athlete-onboarding-invite-codes-v0.1.md §7.6).
    router.replace("/today");
  }, [router]);
  return null;
}

function JoinShell({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-screen bg-stone-100 text-slate-900">
      <header className="bg-slate-950 px-6 pb-10 pt-[max(2.5rem,env(safe-area-inset-top))] text-white">
        <div className="mx-auto max-w-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-teal-300">Performance Coach</p>
        </div>
      </header>
      <div className="mx-auto -mt-6 max-w-sm px-4 pb-[max(2rem,env(safe-area-inset-bottom))]">
        <div className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-950/5">{children}</div>
      </div>
    </main>
  );
}
