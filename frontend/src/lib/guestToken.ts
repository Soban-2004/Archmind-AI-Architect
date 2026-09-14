// The one thing standing in for a real account in this guest-mode app
// (see backend/app/db/schema.sql's own comment on the `owner_token`
// column for the full picture) — a random, opaque id generated once per
// browser, sent as the X-Guest-Token header on every API call so the
// backend can tell "your projects" apart from everyone else's without
// any login at all.
//
// The honest limitation: this lives in localStorage. Clear site data,
// switch browsers, or use a different device, and this identity — and
// every project tied to it — is gone for good. There's no account to
// log back into; that's the deliberate tradeoff for skipping a signup
// screen entirely.
const GUEST_TOKEN_KEY = "ai-architect-guest-token";

let cached: string | null = null;

export function getGuestToken(): string {
  if (cached) return cached;
  if (typeof window === "undefined") return ""; // SSR/build-time guard — never actually sent from there
  try {
    let token = localStorage.getItem(GUEST_TOKEN_KEY);
    if (!token) {
      token = crypto.randomUUID();
      localStorage.setItem(GUEST_TOKEN_KEY, token);
    }
    cached = token;
    return token;
  } catch {
    // Private browsing / blocked storage — fail soft to a per-request
    // random token rather than throwing. This means such a visitor's
    // projects won't persist as "theirs" across reloads, which is the
    // best this mechanism can honestly offer without storage access.
    return crypto.randomUUID();
  }
}
