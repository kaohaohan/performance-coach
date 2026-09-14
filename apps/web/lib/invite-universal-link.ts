export const INVITE_HOST = "dontworkout.vercel.app";
export const INVITE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

const INVITE_CODE = new RegExp(`^[${INVITE_ALPHABET}]{10}$`);

/** Return the internal join route for a production invite URL, or null. */
export function parseInviteUniversalLink(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  if (url.protocol !== "https:" || url.hostname !== INVITE_HOST || url.port) {
    return null;
  }

  const match = url.pathname.match(/^\/join\/([^/]+)$/);
  if (!match || !INVITE_CODE.test(match[1])) return null;
  return `/join/${match[1]}`;
}
