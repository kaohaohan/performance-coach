const KEY = "pump.auth.pendingEmailVerify";

export type PendingEmailVerify =
  | { flow: "join"; code: string; name: string; email: string }
  | { flow: "coachSignup"; name: string; email: string };

export function savePendingEmailVerify(pending: PendingEmailVerify): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(KEY, JSON.stringify(pending));
  } catch {
    // sessionStorage unavailable (private mode, quota, etc.)
  }
}

export function readPendingEmailVerify(): PendingEmailVerify | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingEmailVerify;
    if (parsed.flow === "join" && parsed.code && parsed.name && parsed.email) {
      return parsed;
    }
    if (parsed.flow === "coachSignup" && parsed.name && parsed.email) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export function clearPendingEmailVerify(): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
