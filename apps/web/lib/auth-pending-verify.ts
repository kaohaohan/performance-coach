const KEY = "pump.auth.pendingEmailVerify";

export type PendingEmailVerify =
  | { flow: "join"; code: string; name: string; email: string }
  | { flow: "coachSignup"; name: string; email: string };

export function savePendingEmailVerify(pending: PendingEmailVerify): void {
  if (typeof window === "undefined") return;
  try {
    // localStorage, not sessionStorage: Gmail's verify link opens a new tab,
    // and sessionStorage does not survive that.
    window.localStorage.setItem(KEY, JSON.stringify(pending));
  } catch {
    // localStorage unavailable (private mode, quota, etc.)
  }
}

export function readPendingEmailVerify(): PendingEmailVerify | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
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

export function pendingJoinName(code: string, typedName: string): string {
  const typed = typedName.trim();
  if (typed) return typed;
  const pending = readPendingEmailVerify();
  if (pending?.flow === "join" && pending.code === code) return pending.name;
  return "";
}

export function clearPendingEmailVerify(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
