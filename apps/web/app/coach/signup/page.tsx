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
import { apiFetch } from "@/lib/api";
import { getFirebaseAuth } from "@/lib/firebase";
import { AuthDivider, GoogleSignInButton } from "@/components/google-sign-in-button";
import { AuthHero } from "@/components/auth-hero";
import { AppleSignInButton } from "@/components/apple-sign-in-button";
import { useT, type MessageKey } from "@/lib/i18n";
import {
  APPLE_AUTH_POLICY,
  GOOGLE_AUTH_POLICY,
  PASSWORD_AUTH_CODES,
  errorMessage,
  resolveError,
  type ErrorPolicy,
  type TranslateFn,
} from "@/lib/i18n/errors";

type Me = { id: string; name: string; role: "COACH" | "ATHLETE" };

// The email/password half of this page creates an account, so it opts into
// the full PASSWORD_AUTH_CODES table — email-already-in-use and
// weak-password are only reachable here and on /join/[code]'s create tab.
// It is opt-in rather than global for the reason lib/i18n/errors.ts spells
// out: auth/invalid-credential means "incorrect email or password" on a
// password form and something else entirely on a provider popup.
const SIGNUP_AUTH_POLICY: ErrorPolicy = {
  codes: { ...PASSWORD_AUTH_CODES },
};

// Provisioning is the POST /coach-signup half. 409 is the one an athlete can
// actually trigger — signing up as a coach with an identity that already
// redeemed an invite — and the backend never promotes ATHLETE to COACH, so
// it gets its own sentence rather than a bare conflict. Anything else the
// API explains itself, hence serverMessage.
const PROVISIONING_POLICY: ErrorPolicy = {
  statuses: { 409: "auth.coachSignup.error.athleteAccount" },
  serverMessage: true,
  fallback: "auth.coachSignup.error.provisioningFailed",
};

const RETRY_PROVISIONING_POLICY: ErrorPolicy = {
  serverMessage: true,
  fallback: "auth.coachSignup.error.retryFailed",
};

// provisioningMessage wraps the API's own sentence in this page's framing
// instead of showing it bare: the Firebase account already exists by the
// time either policy is reached, and "we couldn't finish setting it up" is
// the part the coach needs in order to know that Retry is worth pressing.
// resolveError rather than errorMessage because only the resolution says
// whether the text came from the server, and that is what decides which of
// the two keys is used.
function provisioningMessage(
  t: TranslateFn,
  err: unknown,
  policy: ErrorPolicy,
  detailKey: MessageKey,
): string {
  const resolved = resolveError(err, policy);
  switch (resolved.kind) {
    case "text":
      return t(detailKey, { detail: resolved.text });
    case "key":
      return t(resolved.key);
    // Unreachable: neither provisioning policy silences anything.
    case "silent":
      return t("errors.unexpected");
  }
}

export default function CoachSignupPage() {
  const router = useRouter();
  const t = useT();
  const { signUp, signInWithGoogle, signInWithApple, signOut } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [googlePending, setGooglePending] = useState(false);
  const [applePending, setApplePending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Firebase account creation succeeded but backend provisioning failed —
  // a real (if unusual) split-failure state, not a case to paper over: we
  // never claim signup succeeded when the coach has no PostgreSQL `users`
  // row yet. Retrying re-POSTs /coach-signup for the same Firebase
  // account without creating a second one (Signup is idempotent on an
  // existing COACH row).
  const [provisioningFailed, setProvisioningFailed] = useState(false);
  // Social authentication (Google or Apple) has completed and this
  // Firebase identity is now signed in, but no COACH row exists yet. The
  // card switches to confirming the name athletes will see — the backend
  // requires one when it creates the row, the provider's displayName is a
  // reasonable default rather than an authority on what a coach wants to
  // be called, and neither provider always supplies one: Apple only
  // returns a name on the first-ever authorization, so the field must be
  // able to stay empty and be filled by hand. Which provider signed in is
  // kept only so the confirm card's copy is honest.
  const [socialProvider, setSocialProvider] = useState<"google" | "apple" | null>(null);
  const socialConfirm = socialProvider !== null;

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
        setError(
          provisioningMessage(
            t,
            err,
            PROVISIONING_POLICY,
            "auth.coachSignup.error.provisioningFailedDetail",
          ),
        );
      }
    } catch (err) {
      setError(errorMessage(t, err, SIGNUP_AUTH_POLICY));
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
      setSocialProvider("google");
    } catch (err) {
      const message = errorMessage(t, err, GOOGLE_AUTH_POLICY);
      if (message) setError(message);
    } finally {
      setGooglePending(false);
    }
  }

  // handleAppleSignIn reuses the Google post-auth flow exactly: the same
  // confirm-the-name card, the same provisioning path. When Apple returns
  // no displayName the pre-fill is simply skipped — the name field stays
  // empty for the coach to fill; no name is invented.
  async function handleAppleSignIn() {
    setError(null);
    setProvisioningFailed(false);
    setApplePending(true);
    try {
      const { user } = await signInWithApple();
      if (!name.trim() && user.displayName) setName(user.displayName);
      setSocialProvider("apple");
    } catch (err) {
      const message = errorMessage(t, err, APPLE_AUTH_POLICY);
      if (message) setError(message);
    } finally {
      setApplePending(false);
    }
  }

  // handleSocialConfirm provisions the COACH row for the social identity
  // already signed in. The token is minted fresh from the current Firebase
  // user rather than reusing the one the social sign-in returned, so a
  // coach who pauses on the name field cannot submit a stale token.
  async function handleSocialConfirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const coachName = name.trim();
    if (!coachName) {
      setError(t("auth.coachSignup.error.nameRequired"));
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const currentUser = getFirebaseAuth().currentUser;
      if (!currentUser) {
        setSocialProvider(null);
        setError(t("auth.coachSignup.error.sessionExpiredSignInAgain"));
        return;
      }
      await provisionCoach(await currentUser.getIdToken(), coachName);
    } catch (err) {
      setError(
        provisioningMessage(
          t,
          err,
          PROVISIONING_POLICY,
          "auth.coachSignup.error.provisioningFailedDetail",
        ),
      );
    } finally {
      setSubmitting(false);
    }
  }

  // Escape hatch for picking the wrong account: sign the identity back out
  // so the next attempt starts from the provider's account prompt rather
  // than silently reusing it.
  async function handleUseDifferentAccount() {
    setError(null);
    setSocialProvider(null);
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
        setError(t("auth.coachSignup.error.sessionExpiredSignInInstead"));
        setProvisioningFailed(false);
        return;
      }
      const token = await currentUser.getIdToken(true);
      await provisionCoach(token, name.trim());
    } catch (err) {
      setError(
        provisioningMessage(
          t,
          err,
          RETRY_PROVISIONING_POLICY,
          "auth.coachSignup.error.retryFailedDetail",
        ),
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-stone-100 text-slate-900">
      <AuthHero>
        <h1 className="mt-6 text-4xl font-semibold tracking-tight">{t("auth.coachSignup.heroTitleLine1")}<br />{t("auth.coachSignup.heroTitleLine2")}</h1>
        <p className="mt-4 max-w-xs text-base leading-7 text-slate-300">{t("auth.coachSignup.heroSubtitle")}</p>
      </AuthHero>
      <div className="mx-auto -mt-8 max-w-sm px-4 pb-[max(2rem,env(safe-area-inset-bottom))]">
        <form onSubmit={socialConfirm ? handleSocialConfirm : handleSubmit} className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-950/5">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{t("auth.eyebrow")}</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight">{socialConfirm ? t("auth.coachSignup.confirmHeading") : t("auth.createCoachAccount")}</h2>

          {socialConfirm ? (
            /* "Google"/"Apple" are product names and stay in Latin script in
               every locale, so the provider is interpolated rather than
               branched into two translated sentences. */
            <p className="mt-2 text-sm leading-6 text-slate-600">{t("auth.coachSignup.confirmIntro", { provider: socialProvider === "apple" ? "Apple" : "Google" })}</p>
          ) : (
            <>
              <div className="mt-6 grid gap-3">
                {/* Apple first on iOS (Guideline 4.8 equivalent prominence);
                    null on web, where only the Google button renders. */}
                <AppleSignInButton onClick={handleAppleSignIn} pending={applePending} disabled={submitting || provisioningFailed || googlePending} />
                <GoogleSignInButton onClick={handleGoogleSignIn} pending={googlePending} disabled={submitting || provisioningFailed || applePending} />
              </div>
              <AuthDivider />
            </>
          )}

          <div className={socialConfirm ? "mt-6 grid gap-4" : "grid gap-4"}>
            <label>
              <span className="mb-1.5 block text-sm font-semibold text-slate-700">{t("auth.field.name")}{socialConfirm && <span className="text-red-600"> *</span>}</span>
              <input type="text" required autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} maxLength={80} disabled={provisioningFailed} className="min-h-14 w-full rounded-xl border border-slate-200 bg-stone-50 px-4 text-base outline-none focus:border-teal-600 focus:bg-white focus:ring-2 focus:ring-teal-600/15 disabled:opacity-60" />
            </label>
            {/* Apple (and occasionally Google) does not share a displayName,
                so the confirm card can open with an empty field. Without a
                cue that reads as a backend failure — say why it is empty
                and that typing a name is the way forward. */}
            {socialConfirm && !name.trim() && (
              <p role="alert" className="-mt-2 text-sm font-medium text-red-600">
                {socialProvider === "apple" ? t("auth.coachSignup.nameMissingApple") : t("auth.coachSignup.nameMissingProvider")}
              </p>
            )}
            {!socialConfirm && (
              <>
                <label>
                  <span className="mb-1.5 block text-sm font-semibold text-slate-700">{t("auth.field.email")}</span>
                  <input type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} disabled={provisioningFailed} className="min-h-14 w-full rounded-xl border border-slate-200 bg-stone-50 px-4 text-base outline-none focus:border-teal-600 focus:bg-white focus:ring-2 focus:ring-teal-600/15 disabled:opacity-60" />
                </label>
                <label>
                  <span className="mb-1.5 block text-sm font-semibold text-slate-700">{t("auth.field.password")}</span>
                  <input type="password" required minLength={8} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} disabled={provisioningFailed} className="min-h-14 w-full rounded-xl border border-slate-200 bg-stone-50 px-4 text-base outline-none focus:border-teal-600 focus:bg-white focus:ring-2 focus:ring-teal-600/15 disabled:opacity-60" />
                </label>
              </>
            )}
          </div>

          {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 px-3 py-2.5 text-sm font-medium text-red-700">{error}</p>}

          {provisioningFailed ? (
            <button type="button" onClick={handleRetryProvisioning} disabled={submitting} className="mt-6 min-h-14 w-full rounded-2xl bg-teal-600 px-5 text-base font-bold text-white shadow-sm transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500">{submitting ? t("auth.coachSignup.retrying") : t("auth.coachSignup.retry")}</button>
          ) : (
            <button type="submit" disabled={submitting || googlePending || applePending || (socialConfirm && !name.trim())} className="mt-6 min-h-14 w-full rounded-2xl bg-teal-600 px-5 text-base font-bold text-white shadow-sm transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500">{submitting ? t("auth.coachSignup.submitting") : t("auth.createCoachAccount")}</button>
          )}

          {socialConfirm && (
            <button type="button" onClick={handleUseDifferentAccount} disabled={submitting} className="mt-3 min-h-11 w-full text-sm font-bold text-slate-600 transition hover:text-slate-900 disabled:text-slate-300">{t("auth.coachSignup.useDifferentAccount")}</button>
          )}
        </form>
        <p className="mt-5 text-center text-sm text-slate-600">
          {t("auth.haveAccount")} <Link href="/login" className="font-bold text-teal-700 hover:text-teal-800">{t("auth.signIn")}</Link>
        </p>
      </div>
    </main>
  );
}
