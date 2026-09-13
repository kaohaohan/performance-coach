// The four unauthenticated entry points: /login, /coach/signup, /join and
// /join/[code]. One area file because they share a vocabulary — the same
// field labels, the same "already have an account?" footer, the same
// provider buttons — and because splitting them would put four sessions'
// worth of keys in four files that always change together.
//
// Error copy that any sign-in surface can show lives in errors.ts and is
// reached through lib/i18n/errors.ts. What is here is the copy only these
// pages can produce: coach provisioning outcomes, and the invite flow's own
// states.
//
// A few keys that read like shared vocabulary (auth.field.email,
// auth.continue, auth.signIn) sit here rather than in common.ts on purpose:
// common.ts is owned by a concurrent sub-task, so adding to it would be a
// merge conflict in the one file every other area depends on. Promoting them
// to common.* is a later, mechanical move once the parallel sessions land.
export const auth = {
  // --- shared across the four pages ---------------------------------
  "auth.eyebrow": "Coach & Client Training",
  "auth.field.name": "Name",
  "auth.field.email": "Email",
  "auth.field.password": "Password",
  "auth.continue": "Continue",
  "auth.signIn": "Sign in",
  "auth.signingIn": "Signing in…",
  "auth.createAccount": "Create account",
  "auth.creatingAccount": "Creating account…",
  "auth.createCoachAccount": "Create Coach Account",
  "auth.haveAccount": "Already have an account?",

  // Provider buttons. "Google" and "Apple" are product names and stay in
  // Latin script in every locale — only the sentence around them changes.
  "auth.provider.google": "Continue with Google",
  "auth.provider.googlePending": "Opening Google…",
  "auth.provider.apple": "Sign in with Apple",
  "auth.provider.applePending": "Opening Apple…",
  "auth.divider.or": "or",

  // --- /login --------------------------------------------------------
  // The hero headline is two keys, not one string with a <br />: the line
  // break falls in a different place in Chinese, and markup inside a
  // translated string is exactly how a locale ends up unable to move it.
  "auth.login.heroTitleLine1": "Train.",
  "auth.login.heroTitleLine2": "Track. Improve.",
  "auth.login.heroSubtitle": "A focused training space for coaches and clients.",
  "auth.login.heading": "Sign in",
  "auth.login.submit": "Sign In",
  "auth.login.submitting": "Signing in…",
  "auth.login.inviteHint": "Have an invite code?",
  "auth.login.inviteLink": "Join a coach",
  // The "no application user" notice is split at its two links rather than
  // interpolated: interpolation takes strings, and a <Link> is not one.
  // Each fragment is a whole clause so a translator can reorder them.
  "auth.login.noAccount.intro": "We couldn't find an account for that sign-in.",
  "auth.login.noAccount.joinPrompt": "Joining a coach?",
  "auth.login.noAccount.joinLink": "Use your invite code",
  "auth.login.noAccount.coachPrompt": "Coaching?",
  "auth.login.noAccount.coachLink": "Create a Coach account",

  // --- /coach/signup --------------------------------------------------
  "auth.coachSignup.heroTitleLine1": "Build your",
  "auth.coachSignup.heroTitleLine2": "coaching practice.",
  "auth.coachSignup.heroSubtitle":
    "Create your Coach account to start programming and inviting clients.",
  "auth.coachSignup.confirmHeading": "Confirm your name",
  "auth.coachSignup.confirmIntro":
    "You're signed in with {provider}. This is the name your clients will see.",
  "auth.coachSignup.nameMissingApple":
    "Apple didn't share your name — enter it above to continue.",
  "auth.coachSignup.nameMissingProvider":
    "Your sign-in didn't include a name — enter it above to continue.",
  "auth.coachSignup.submitting": "Creating account…",
  "auth.coachSignup.retry": "Retry account setup",
  "auth.coachSignup.retrying": "Retrying…",
  "auth.coachSignup.useDifferentAccount": "Use a different account",
  "auth.coachSignup.error.nameRequired": "Enter the name your clients will see.",
  "auth.coachSignup.error.sessionExpiredSignInAgain":
    "Your session expired. Please sign in again.",
  "auth.coachSignup.error.sessionExpiredSignInInstead":
    "Your session expired. Please sign in instead.",
  // The 409 an athlete can actually trigger: the backend never promotes an
  // ATHLETE row to COACH, and a bare conflict would not say so.
  "auth.coachSignup.error.athleteAccount":
    "That account is already registered as a client. Sign in instead, or use a different account.",
  // Both provisioning failures keep the "the account exists, the setup
  // didn't finish" framing. The Firebase account is real at this point, so
  // the server's own sentence alone would read as if nothing had happened.
  "auth.coachSignup.error.provisioningFailed":
    "Your account was created, but we couldn't finish setting it up. Please try again.",
  "auth.coachSignup.error.provisioningFailedDetail":
    "Your account was created, but we couldn't finish setting it up: {detail}",
  "auth.coachSignup.error.retryFailed":
    "We still couldn't finish setting up your account. Please try again.",
  "auth.coachSignup.error.retryFailedDetail":
    "We still couldn't finish setting up your account: {detail}",

  // --- /join ----------------------------------------------------------
  "auth.join.heroTitle": "Join your coach.",
  "auth.join.heroSubtitle": "Enter the code your coach sent you.",
  "auth.join.codeLabel": "Join code",

  // --- /join/[code] ---------------------------------------------------
  "auth.joinCode.checkingInvite": "Checking your invite…",
  "auth.joinCode.invalidHeading": "This code isn't valid.",
  "auth.joinCode.invalidBody":
    "It may have expired or been revoked. Ask your coach for a new link.",
  "auth.joinCode.enterAnotherCode": "Enter another code",
  "auth.joinCode.useAnotherCode": "Use another code",
  "auth.joinCode.joining": "You're joining",
  "auth.joinCode.checkingAccount": "Checking your account…",
  // Two variants rather than an interpolated "" — /me does not always
  // return a name, and "signed in as a Coach ()" is worse than saying less.
  "auth.joinCode.coachSignedIn": "You're currently signed in as a Coach.",
  "auth.joinCode.coachSignedInNamed": "You're currently signed in as a Coach ({name}).",
  "auth.joinCode.coachSignedInBody":
    "Sign out to join {coach} with a Client account. Your Coach account isn't changed by this.",
  "auth.joinCode.signOutAndContinue": "Sign out and continue",
  "auth.joinCode.stayAsCoach": "Stay signed in as a Coach",
  "auth.joinCode.authTabsLabel": "Sign in or create account",
  "auth.joinCode.connecting": "Connecting…",
  "auth.joinCode.tryAgain": "Try again",
  "auth.joinCode.connected": "You're connected to {coach}.",
  "auth.joinCode.redirecting": "Taking you to your training…",
} as const;

export type AuthMessages = Record<keyof typeof auth, string>;
