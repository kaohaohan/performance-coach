"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { useT } from "@/lib/i18n";

type EmailVerificationPromptProps = {
  email: string;
  onVerified: () => void;
};

export function EmailVerificationPrompt({ email, onVerified }: EmailVerificationPromptProps) {
  const t = useT();
  const { user, sendVerificationEmail, reloadUser } = useAuth();
  const [busy, setBusy] = useState<"resend" | "check" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resent, setResent] = useState(false);
  const continued = useRef(false);

  useEffect(() => {
    if (!user?.emailVerified || continued.current) return;
    continued.current = true;
    onVerified();
  }, [onVerified, user?.emailVerified]);

  async function handleResend() {
    setError(null);
    setBusy("resend");
    try {
      await sendVerificationEmail();
      setResent(true);
    } catch {
      setError(t("auth.verify.resendFailed"));
    } finally {
      setBusy(null);
    }
  }

  async function handleCheck() {
    setError(null);
    setBusy("check");
    try {
      const current = await reloadUser();
      if (!current?.emailVerified) {
        setError(t("auth.verify.notYet"));
      }
    } catch {
      setError(t("auth.verify.checkFailed"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-6">
      <h2 className="text-xl font-semibold tracking-tight">{t("auth.verify.heading")}</h2>
      <p className="mt-2 text-sm leading-6 text-slate-600">{t("auth.verify.body", { email })}</p>
      {resent ? <p className="mt-3 text-sm font-medium text-slate-700">{t("auth.verify.resent")}</p> : null}
      {error ? <p role="alert" className="mt-3 rounded-xl bg-red-50 px-3 py-2.5 text-sm font-medium text-red-700">{error}</p> : null}
      <button
        type="button"
        onClick={() => void handleCheck()}
        disabled={busy !== null}
        className="mt-6 min-h-14 w-full rounded-2xl bg-teal-600 px-5 text-base font-bold text-white shadow-sm transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
      >
        {busy === "check" ? t("auth.verify.checking") : t("auth.verify.continue")}
      </button>
      <button
        type="button"
        onClick={() => void handleResend()}
        disabled={busy !== null}
        className="mt-3 min-h-11 w-full text-sm font-bold text-slate-600 transition hover:text-slate-900 disabled:text-slate-300"
      >
        {busy === "resend" ? t("auth.verify.resending") : t("auth.verify.resend")}
      </button>
    </div>
  );
}
