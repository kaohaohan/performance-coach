"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { useT } from "@/lib/i18n";

// Shared sign-out control for the dark page headers. Each caller supplies a
// className matching its own header's button style (eyebrow-row text button,
// nav-row button, etc.) — this component only owns the signOut + redirect
// behavior.
export default function SignOutButton({ className = "" }: { className?: string }) {
  const router = useRouter();
  const { signOut } = useAuth();
  const t = useT();
  const [signingOut, setSigningOut] = useState(false);

  async function handleSignOut() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await signOut();
      router.replace("/login");
    } catch (err) {
      console.error("sign-out-button: failed to sign out:", err);
      setSigningOut(false);
    }
  }

  return (
    <button type="button" onClick={handleSignOut} disabled={signingOut} className={className}>
      {signingOut ? t("common.signingOut") : t("common.signOut")}
    </button>
  );
}
