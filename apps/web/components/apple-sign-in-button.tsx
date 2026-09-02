"use client";

// The single Apple entry point shared by /login, /join/[code] and
// /coach/signup — same reasoning as google-sign-in-button.tsx: one
// component so the three journeys cannot drift apart in wording, size or
// error handling.
//
// Rendered only inside the native iOS shell. Guideline 4.8 requires Sign
// in with Apple as an equivalent option wherever a third-party social
// login is offered on the App Store build; on web it returns null, so
// callers stay platform-agnostic and the web auth surface is unchanged.
// The button matches GoogleSignInButton's dimensions exactly (equivalent
// prominence) and uses Apple's HIG-conformant black style.
import { Capacitor } from "@capacitor/core";
// As with the Google button, error handling is not here: the three call
// sites resolve their own failures through errorMessage(t, err,
// APPLE_AUTH_POLICY) from lib/i18n/errors.ts — including the
// account-collision wording this flow must never share with Google's. The
// pre-i18n English-only bridge that used to sit here went with its last
// caller.
import { useT } from "@/lib/i18n";

// AppleMark is Apple's logo, inlined so the button renders without a
// network round-trip and works offline in the PWA shell.
function AppleMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 shrink-0 fill-current">
      <path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701" />
    </svg>
  );
}

// AppleSignInButton must only ever be rendered as an explicit tap target:
// the native sheet is invoked from the user gesture's call stack.
export function AppleSignInButton({
  onClick,
  pending,
  disabled,
  label,
}: {
  onClick: () => void;
  pending?: boolean;
  disabled?: boolean;
  label?: string;
}) {
  // Called before the platform check so the hook order is the same on every
  // render, web included, where this component returns null.
  const t = useT();
  if (Capacitor.getPlatform() !== "ios") {
    return null;
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending || disabled}
      className="flex min-h-14 w-full items-center justify-center gap-3 rounded-2xl bg-black px-5 text-base font-bold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-stone-100 disabled:text-slate-400"
    >
      {pending ? null : <AppleMark />}
      {pending ? t("auth.provider.applePending") : label ?? t("auth.provider.apple")}
    </button>
  );
}
