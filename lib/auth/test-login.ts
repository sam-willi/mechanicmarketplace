import "server-only";

/**
 * Local test sign-in for browser-testing the real (live) marketplace without
 * Supabase or real people. Only when all hold:
 *  - CLUTCH_TEST_LOGINS=on (off by default),
 *  - not a production build,
 *  - no DATABASE_URL (in-memory data), or a database on this machine (a disposable test cluster).
 * Test accounts use reserved example.test addresses.
 */
export const TEST_USER_COOKIE = "clutch_test_user";

export function testLoginsEnabled() {
  return process.env.CLUTCH_TEST_LOGINS === "on" && process.env.NODE_ENV !== "production" && (!process.env.DATABASE_URL || localDatabase(process.env.DATABASE_URL));
}

/** A database on this machine (a disposable test cluster), never a hosted one. */
function localDatabase(url: string) {
  try {
    const h = new URL(url).hostname;
    return h === "127.0.0.1" || h === "localhost" || h === "::1";
  } catch {
    return false;
  }
}
