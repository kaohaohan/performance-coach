"use client";

// Preview -> confirm -> auth -> redeem -> Today
// (docs/athlete-onboarding-invite-codes-v0.1.md §7.6). One route, one
// stepped local state machine — auth happens inline here, never a redirect
// to /login, which is what makes "login-return-to-invite" a non-problem.
// Google sign-in uses a popup for the same reason: the invite code never
// has to survive a navigation, so it cannot be lost or mixed up with
// another one.
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { ApiError, apiFetch, publicApiFetch } from "@/lib/api";
import { AuthDivider, GoogleSignInButton } from "@/components/google-sign-in-button";
import { BRAND_NAME } from "@/lib/brand";
import { AppleSignInButton } from "@/components/apple-sign-in-button";
import { useT } from "@/lib/i18n";
import {
  APPLE_AUTH_POLICY,
  GOOGLE_AUTH_POLICY,
  PASSWORD_AUTH_CODES,
  errorMessage,
  type ErrorPolicy,
} from "@/lib/i18n/errors";

type Preview = { code: string; coachName: string; description: string | null };
type Redeemed = { user: { id: string; name: string; role: "ATHLETE" }; coach: { name: string } };
type Me = { id: string; name: string; role: "COACH" | "ATHLETE" };
type Step =
  | "loading"
  | "invalid"
  | "confirming"
  | "checkingSession"
  | "coachSignedIn"
  | "authenticating"
  | "redeeming"
  | "onboarded";

// Redeem and the /me role check are the API's to explain: it is the
// authority on why it rejected a request, so its own sentence is passed
// through rather than replaced with a generic one.
const REDEEM_POLICY: ErrorPolicy = { serverMessage: true };

// The email/password tabs create accounts as well as sign in, so this form
// opts into the whole PASSWORD_AUTH_CODES table. It is opt-in rather than
// global precisely so that auth/invalid-credential keeps reading as
// "Incorrect email or password" here without putting that sentence on a
// provider popup, where it would be nonsense (lib/i18n/errors.ts).
const JOIN_AUTH_POLICY: ErrorPolicy = {
  codes: { ...PASSWORD_AUTH_CODES },
  serverMessage: true,
};

// The provider policies plus serverMessage: a social join can fail at the
// provider (a code the policy maps, or a dismissal it silences) or at the
// API afterwards, and one policy now covers both — replacing the
// `err instanceof ApiError ? … : …` fork the two handlers used to carry.
const GOOGLE_JOIN_POLICY: ErrorPolicy = { ...GOOGLE_AUTH_POLICY, serverMessage: true };
const APPLE_JOIN_POLICY: ErrorPolicy = { ...APPLE_AUTH_POLICY, serverMessage: true };

function initials(name: string): string {
  return name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
}

export default function JoinCodePage() {
  const params = useParams<{ code: string }>();
  const code = params.code;
  const router = useRouter();
  const t = useT();
  const { user, loading: authLoading, signIn, signUp, signInWithGoogle, signInWithApple, signOut } = useAuth();

  const [step, setStep] = useState<Step>("loading");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [authMode, setAuthMode] = useState<"create" | "signin">("create");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [googlePending, setGooglePending] = useState(false);
  const [applePending, setApplePending] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [redeemError, setRedeemError] = useState<string | null>(null);
  const [redeemed, setRedeemed] = useState<Redeemed | null>(null);
  // Display name of the COACH currently signed in, shown on the
  // coachSignedIn step so it is obvious whose session is in the way.
  const [signedInCoachName, setSignedInCoachName] = useState<string | null>(null);

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

  // freshToken mints a token from the live Firebase user at the moment it
  // is needed, rather than replaying one captured earlier. Retrying redeem
  // with a stored token is what turned a single rejected attempt into an
  // endless loop before; there is no stored token here to go stale.
  async function freshToken(): Promise<string | null> {
    return user ? user.getIdToken() : null;
  }

  async function runRedeem(token: string, athleteName: string) {
    setStep("redeeming");
    setRedeemError(null);
    try {
      const result = await apiFetch<Redeemed>(token, `/api/v1/invite-codes/${encodeURIComponent(code)}/redeem`, {
        method: "POST",
        body: { name: athleteName },
      });
      setRedeemed(result);
      setStep("onboarded");
    } catch (error) {
      // 403 is the API's "a coach account cannot redeem an invite code".
      // Retrying cannot change that, so route to the sign-out step instead
      // of offering a retry that is guaranteed to fail the same way.
      if (error instanceof ApiError && error.status === 403) {
        setStep("coachSignedIn");
        return;
      }
      setRedeemError(errorMessage(t, error, REDEEM_POLICY));
      setStep("authenticating");
    }
  }

  // resolveExistingRole asks the API who a verified Firebase identity
  // already is, *before* trying to redeem with it. A 401 means the token is
  // valid but no application user exists yet — the normal state for someone
  // who signed up and abandoned before redeeming, and for every brand-new
  // Google identity. Redeem is exactly what provisions those, so "NEW" is a
  // green light, not an error.
  async function resolveExistingRole(token: string): Promise<"COACH" | "ATHLETE" | "NEW"> {
    try {
      const me = await apiFetch<Me>(token, "/api/v1/me");
      if (me.role === "COACH") setSignedInCoachName(me.name);
      return me.role;
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return "NEW";
      throw err;
    }
  }

  // continueWithToken is the single gate every authenticated path goes
  // through — the already-live session, and both fresh sign-ins. A Coach
  // never reaches redeem.
  async function continueWithToken(token: string, athleteName: string) {
    const role = await resolveExistingRole(token);
    if (role === "COACH") {
      setStep("coachSignedIn");
      return;
    }
    await runRedeem(token, athleteName);
  }

  // Already has a live Firebase session (e.g. resuming after abandoning
  // mid-flow, signed in from another tab, or still signed in as a Coach) —
  // resolve who that is before doing anything with it
  // (docs/athlete-onboarding-invite-codes-v0.1.md §6, "Athlete abandons
  // after Firebase signup, before redeem").
  async function handleContinue() {
    const token = await freshToken();
    if (!token) {
      setStep("authenticating");
      return;
    }
    setStep("checkingSession");
    setRedeemError(null);
    try {
      await continueWithToken(token, name.trim());
    } catch (error) {
      setRedeemError(errorMessage(t, error, REDEEM_POLICY));
      setStep("confirming");
    }
  }

  async function handleRetryRedeem() {
    const token = await freshToken();
    if (!token) {
      setRedeemError(null);
      setStep("authenticating");
      return;
    }
    await runRedeem(token, name.trim());
  }

  async function handleAuthSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (redeemError) {
      await handleRetryRedeem();
      return;
    }
    setAuthSubmitting(true);
    setAuthError(null);
    try {
      const token = authMode === "create" ? await signUp(email, password) : await signIn(email, password);
      await continueWithToken(token, name.trim());
    } catch (err) {
      // One policy covers both origins: an ApiError here came from the /me
      // role check and carries the server's own sentence, while a Firebase
      // rejection carries a code the password table maps.
      setAuthError(errorMessage(t, err, JOIN_AUTH_POLICY));
      setStep("authenticating");
    } finally {
      setAuthSubmitting(false);
    }
  }

  async function handleGoogleJoin() {
    setGooglePending(true);
    setAuthError(null);
    setRedeemError(null);
    try {
      const { idToken, user: googleUser } = await signInWithGoogle();
      // Name is only used when redeem creates a brand-new ATHLETE row; an
      // athlete who already exists keeps the name they have. Prefer what
      // they typed, fall back to Google's display name.
      const athleteName = name.trim() || googleUser.displayName?.trim() || "";
      await continueWithToken(idToken, athleteName);
    } catch (err) {
      // null means the person dismissed the Google chooser — not a failure.
      const message = errorMessage(t, err, GOOGLE_JOIN_POLICY);
      if (message) setAuthError(message);
      setStep("authenticating");
    } finally {
      setGooglePending(false);
    }
  }

  // handleAppleJoin reuses the Google join path exactly — same
  // continueWithToken gate, same redeem call; only the provider differs.
  // When Apple returns no displayName (it only grants one on first-ever
  // authorization) the typed name stands alone, and if both are empty the
  // redeem request's name validation fails visibly rather than a name
  // being invented.
  async function handleAppleJoin() {
    setApplePending(true);
    setAuthError(null);
    setRedeemError(null);
    try {
      const { idToken, user: appleUser } = await signInWithApple();
      const athleteName = name.trim() || appleUser.displayName?.trim() || "";
      await continueWithToken(idToken, athleteName);
    } catch (err) {
      // null means the person dismissed the Apple sheet — not a failure.
      const message = errorMessage(t, err, APPLE_JOIN_POLICY);
      if (message) setAuthError(message);
      setStep("authenticating");
    } finally {
      setApplePending(false);
    }
  }

  // Signing the Coach out returns the browser to a clean slate so the
  // athlete can authenticate as themselves — with Google or with
  // email/password.
  async function handleSignOutAndContinue() {
    setSignedInCoachName(null);
    setRedeemError(null);
    setAuthError(null);
    try {
      await signOut();
    } catch {
      // Nothing actionable to show: the next sign-in re-authenticates from
      // scratch either way.
    }
    setStep("authenticating");
  }

  if (step === "loading") {
    return (
      <JoinShell>
        <p className="text-sm font-medium text-slate-500">{t("auth.joinCode.checkingInvite")}</p>
      </JoinShell>
    );
  }

  if (step === "invalid") {
    return (
      <JoinShell>
        <h2 className="text-xl font-semibold tracking-tight">{t("auth.joinCode.invalidHeading")}</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">{t("auth.joinCode.invalidBody")}</p>
        <button type="button" onClick={() => router.push("/join")} className="mt-6 min-h-14 w-full rounded-2xl bg-teal-600 px-5 text-base font-bold text-white shadow-sm transition hover:bg-teal-700">{t("auth.joinCode.enterAnotherCode")}</button>
      </JoinShell>
    );
  }

  if (!preview) return null;

  return (
    <JoinShell>
      <div className="flex items-center gap-3">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-slate-100 text-base font-bold text-slate-600">{initials(preview.coachName)}</span>
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{t("auth.joinCode.joining")}</p>
          <p className="truncate text-lg font-semibold text-slate-900">{preview.coachName}</p>
        </div>
      </div>
      {preview.description && <p className="mt-3 rounded-2xl bg-stone-50 px-4 py-3 text-sm leading-6 text-slate-600">{preview.description}</p>}

      {step === "confirming" && (
        <>
          {redeemError && <p role="alert" className="mt-4 rounded-xl bg-red-50 px-3 py-2.5 text-sm font-medium text-red-700">{redeemError}</p>}
          <div className="mt-6 flex gap-3">
            <button type="button" onClick={() => router.push("/join")} className="min-h-14 flex-1 rounded-2xl border border-slate-200 text-base font-bold text-slate-700 transition hover:bg-stone-50">{t("auth.joinCode.useAnotherCode")}</button>
            <button type="button" onClick={handleContinue} disabled={authLoading} className="min-h-14 flex-1 rounded-2xl bg-teal-600 text-base font-bold text-white shadow-sm transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500">{t("auth.continue")}</button>
          </div>
        </>
      )}

      {step === "checkingSession" && (
        <p className="mt-6 text-sm font-medium text-slate-500">{t("auth.joinCode.checkingAccount")}</p>
      )}

      {step === "coachSignedIn" && (
        <div className="mt-6">
          <p className="text-base font-semibold text-slate-900">
            {/* Two whole sentences rather than one with an appended
                parenthetical: /me does not always carry a name, and the
                parenthesis sits differently in Chinese. */}
            {signedInCoachName
              ? t("auth.joinCode.coachSignedInNamed", { name: signedInCoachName })
              : t("auth.joinCode.coachSignedIn")}
          </p>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            {t("auth.joinCode.coachSignedInBody", { coach: preview.coachName })}
          </p>
          <button type="button" onClick={handleSignOutAndContinue} className="mt-6 min-h-14 w-full rounded-2xl bg-teal-600 px-5 text-base font-bold text-white shadow-sm transition hover:bg-teal-700">{t("auth.joinCode.signOutAndContinue")}</button>
          <button type="button" onClick={() => router.push("/coach/calendar")} className="mt-3 min-h-11 w-full text-sm font-bold text-slate-600 transition hover:text-slate-900">{t("auth.joinCode.stayAsCoach")}</button>
        </div>
      )}

      {(step === "authenticating" || step === "redeeming") && (
        <div className="mt-6">
          <div className="grid gap-3">
            {/* Apple first on iOS (Guideline 4.8 equivalent prominence);
                null on web, where only the Google button renders. */}
            <AppleSignInButton onClick={handleAppleJoin} pending={applePending} disabled={authSubmitting || googlePending || step === "redeeming"} />
            <GoogleSignInButton onClick={handleGoogleJoin} pending={googlePending} disabled={authSubmitting || applePending || step === "redeeming"} />
          </div>
          <AuthDivider />

          <div className="flex gap-2" role="tablist" aria-label={t("auth.joinCode.authTabsLabel")}>
            <button type="button" role="tab" aria-selected={authMode === "create"} onClick={() => { setAuthMode("create"); setAuthError(null); }} className={`min-h-11 flex-1 rounded-xl text-sm font-bold transition ${authMode === "create" ? "bg-slate-950 text-white" : "bg-stone-100 text-slate-600 hover:bg-stone-200"}`}>{t("auth.createAccount")}</button>
            <button type="button" role="tab" aria-selected={authMode === "signin"} onClick={() => { setAuthMode("signin"); setAuthError(null); }} className={`min-h-11 flex-1 rounded-xl text-sm font-bold transition ${authMode === "signin" ? "bg-slate-950 text-white" : "bg-stone-100 text-slate-600 hover:bg-stone-200"}`}>{t("auth.signIn")}</button>
          </div>

          <form onSubmit={handleAuthSubmit} className="mt-4 grid gap-4">
            {authMode === "create" && (
              <label>
                <span className="mb-1.5 block text-sm font-semibold text-slate-700">{t("auth.field.name")}</span>
                <input type="text" required autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} maxLength={80} className="min-h-14 w-full rounded-xl border border-slate-200 bg-stone-50 px-4 text-base outline-none focus:border-teal-600 focus:bg-white focus:ring-2 focus:ring-teal-600/15" />
              </label>
            )}
            <label>
              <span className="mb-1.5 block text-sm font-semibold text-slate-700">{t("auth.field.email")}</span>
              <input type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} className="min-h-14 w-full rounded-xl border border-slate-200 bg-stone-50 px-4 text-base outline-none focus:border-teal-600 focus:bg-white focus:ring-2 focus:ring-teal-600/15" />
            </label>
            <label>
              <span className="mb-1.5 block text-sm font-semibold text-slate-700">{t("auth.field.password")}</span>
              <input type="password" required minLength={authMode === "create" ? 8 : undefined} autoComplete={authMode === "create" ? "new-password" : "current-password"} value={password} onChange={(event) => setPassword(event.target.value)} className="min-h-14 w-full rounded-xl border border-slate-200 bg-stone-50 px-4 text-base outline-none focus:border-teal-600 focus:bg-white focus:ring-2 focus:ring-teal-600/15" />
            </label>

            {(authError || redeemError) && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2.5 text-sm font-medium text-red-700">{authError ?? redeemError}</p>}

            <button type="submit" disabled={authSubmitting || googlePending || applePending || step === "redeeming"} className="min-h-14 w-full rounded-2xl bg-teal-600 px-5 text-base font-bold text-white shadow-sm transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500">
              {step === "redeeming" ? t("auth.joinCode.connecting") : redeemError ? t("auth.joinCode.tryAgain") : authSubmitting ? (authMode === "create" ? t("auth.creatingAccount") : t("auth.signingIn")) : authMode === "create" ? t("auth.createAccount") : t("auth.signIn")}
            </button>
          </form>
        </div>
      )}

      {step === "onboarded" && redeemed && (
        <div className="mt-6">
          <p className="text-base font-semibold text-slate-900">{t("auth.joinCode.connected", { coach: redeemed.coach.name })}</p>
          <p className="mt-1 text-sm text-slate-500">{t("auth.joinCode.redirecting")}</p>
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
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-teal-300">{BRAND_NAME}</p>
        </div>
      </header>
      <div className="mx-auto -mt-6 max-w-sm px-4 pb-[max(2rem,env(safe-area-inset-bottom))]">
        <div className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-950/5">{children}</div>
      </div>
    </main>
  );
}
