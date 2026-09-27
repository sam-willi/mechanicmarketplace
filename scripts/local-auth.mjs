// LOCAL TEST FIXTURE: a stand-in for the Supabase Auth (GoTrue) HTTP endpoints Clutch calls, for
// testing the real sign-up / sign-in / session path on a machine without Docker or Supabase.
// It is NOT Supabase and never runs in production: it listens on 127.0.0.1 only, sends no email
// (confirmation links go to a local mailbox you read at /__local/mailbox), and keeps its users in
// the disposable local database (schema local_auth). Real deployments use a Supabase project.
//
//   DATABASE_URL=postgres://clutch@127.0.0.1:54329/clutch_local node scripts/local-auth.mjs
//   then in .env.local:
//     NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54400
//     NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=local-test-key
//
// Supports: sign-up (email confirmation on, as Supabase's default), the confirmation link (PKCE
// code or token hash), password sign-in, refresh, get/update user, sign-out, resend, recover.
import http from "node:http";
import crypto from "node:crypto";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url || !/@(127\.0\.0\.1|localhost)[:/]/.test(url)) {
  console.error("local-auth: DATABASE_URL must point at a local database (127.0.0.1). This fixture never touches a hosted one.");
  process.exit(1);
}
const PORT = Number(process.env.LOCAL_AUTH_PORT ?? 54400);
const AUTOCONFIRM = process.env.LOCAL_AUTH_AUTOCONFIRM === "on";
const BASE = `http://127.0.0.1:${PORT}`;
const TTL = 3600;
const sql = postgres(url, { prepare: false, max: 3, onnotice: () => undefined });

await sql.unsafe(`
  create schema if not exists local_auth;
  create table if not exists local_auth.meta (key text primary key, value text not null);
  create table if not exists local_auth.users (
    id uuid primary key, email text unique not null, password_hash text not null,
    confirmed_at timestamptz, confirmation_sent_at timestamptz, user_metadata jsonb not null default '{}',
    created_at timestamptz not null default now(), updated_at timestamptz not null default now());
  create table if not exists local_auth.tokens (
    token text primary key, kind text not null, user_id uuid not null references local_auth.users(id),
    code_challenge text, redirect_to text, used boolean not null default false, created_at timestamptz not null default now());
  create table if not exists local_auth.refresh (
    token text primary key, user_id uuid not null references local_auth.users(id), session_id uuid not null,
    revoked boolean not null default false, created_at timestamptz not null default now());
  create table if not exists local_auth.mailbox (
    id bigserial primary key, email text not null, kind text not null, link text not null, token_hash text not null, created_at timestamptz not null default now());
`);
// One signing secret per database, so sessions survive a restart of this fixture or the app.
await sql`insert into local_auth.meta (key, value) values ('jwt_secret', ${crypto.randomBytes(32).toString("hex")}) on conflict do nothing`;
const [{ value: SECRET }] = await sql`select value from local_auth.meta where key = 'jwt_secret'`;

const b64u = (b) => Buffer.from(b).toString("base64url");
function jwt(user, sessionId) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: `${BASE}/auth/v1`, sub: user.id, aud: "authenticated", exp: now + TTL, iat: now, email: user.email, phone: "",
    app_metadata: { provider: "email", providers: ["email"] }, user_metadata: user.user_metadata, role: "authenticated",
    aal: "aal1", amr: [{ method: "password", timestamp: now }], session_id: sessionId, is_anonymous: false,
  };
  const head = b64u(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64u(JSON.stringify(payload));
  return `${head}.${body}.${b64u(crypto.createHmac("sha256", SECRET).update(`${head}.${body}`).digest())}`;
}
function verifyJwt(token) {
  const [h, p, s] = String(token ?? "").split(".");
  if (!s) return null;
  const good = b64u(crypto.createHmac("sha256", SECRET).update(`${h}.${p}`).digest());
  if (good.length !== s.length || !crypto.timingSafeEqual(Buffer.from(good), Buffer.from(s))) return null;
  const claims = JSON.parse(Buffer.from(p, "base64url").toString());
  return claims.exp > Date.now() / 1000 ? claims : null;
}
const hash = (pw) => {
  const salt = crypto.randomBytes(16).toString("hex");
  return `${salt}:${crypto.scryptSync(pw, salt, 32).toString("hex")}`;
};
const checkPw = (pw, stored) => {
  const [salt, h] = stored.split(":");
  return crypto.timingSafeEqual(Buffer.from(h, "hex"), crypto.scryptSync(pw, salt, 32));
};
const userJson = (u) => ({
  id: u.id, aud: "authenticated", role: "authenticated", email: u.email, phone: "",
  email_confirmed_at: u.confirmed_at?.toISOString?.() ?? u.confirmed_at ?? null, confirmed_at: u.confirmed_at?.toISOString?.() ?? u.confirmed_at ?? null,
  confirmation_sent_at: u.confirmation_sent_at?.toISOString?.() ?? null, last_sign_in_at: new Date().toISOString(),
  app_metadata: { provider: "email", providers: ["email"] }, user_metadata: u.user_metadata,
  identities: [{ id: u.id, user_id: u.id, identity_data: { sub: u.id, email: u.email }, provider: "email", identity_id: u.id }],
  created_at: new Date(u.created_at).toISOString(), updated_at: new Date(u.updated_at).toISOString(), is_anonymous: false,
});
async function session(u) {
  const sid = crypto.randomUUID();
  const refresh = crypto.randomBytes(24).toString("base64url");
  await sql`insert into local_auth.refresh (token, user_id, session_id) values (${refresh}, ${u.id}, ${sid})`;
  return { access_token: jwt(u, sid), token_type: "bearer", expires_in: TTL, expires_at: Math.floor(Date.now() / 1000) + TTL, refresh_token: refresh, user: userJson(u) };
}
async function mail(u, kind, redirectTo, challenge) {
  const token = crypto.randomBytes(20).toString("hex");
  await sql`insert into local_auth.tokens (token, kind, user_id, code_challenge, redirect_to) values (${token}, ${kind}, ${u.id}, ${challenge ?? null}, ${redirectTo ?? null})`;
  const link = `${BASE}/auth/v1/verify?token=${token}&type=${kind}${redirectTo ? `&redirect_to=${encodeURIComponent(redirectTo)}` : ""}`;
  await sql`insert into local_auth.mailbox (email, kind, link, token_hash) values (${u.email}, ${kind}, ${link}, ${token})`;
  await sql`update local_auth.users set confirmation_sent_at = now() where id = ${u.id}`;
}
const err = (res, status, code, msg) => send(res, status, { code: status, error_code: code, msg });
function send(res, status, body, headers = {}) {
  res.writeHead(status, { "content-type": "application/json", "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*", ...headers });
  res.end(body === undefined ? "" : JSON.stringify(body));
}
async function bodyOf(req) {
  let s = "";
  for await (const c of req) s += c;
  try { return s ? JSON.parse(s) : {}; } catch { return {}; }
}
async function userFromAuth(req) {
  const claims = verifyJwt((req.headers.authorization ?? "").replace(/^Bearer /i, ""));
  if (!claims) return null;
  const [live] = await sql`select 1 from local_auth.refresh where session_id = ${claims.session_id} and not revoked limit 1`;
  if (!live) return null;
  const [u] = await sql`select * from local_auth.users where id = ${claims.sub}`;
  return u ? { u, claims } : null;
}

http.createServer(async (req, res) => {
  try {
    const q = new URL(req.url, BASE);
    const path = q.pathname.replace(/^\/auth\/v1/, "");
    if (req.method === "OPTIONS") return send(res, 204);
    if (path === "/health") return send(res, 200, { name: "local-auth (test fixture, not Supabase)" });
    if (path === "/__local/mailbox") {
      const rows = await sql`select email, kind, link, token_hash, created_at from local_auth.mailbox where email = ${String(q.searchParams.get("email") ?? "").toLowerCase()} order by id desc`;
      return send(res, 200, rows);
    }
    if (path === "/signup" && req.method === "POST") {
      const b = await bodyOf(req);
      const email = String(b.email ?? "").toLowerCase().trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return err(res, 400, "email_address_invalid", "Unable to validate email address: invalid format");
      if (String(b.password ?? "").length < 8) return err(res, 422, "weak_password", "Password should be at least 8 characters.");
      const [had] = await sql`select * from local_auth.users where email = ${email}`;
      // Like Supabase: an existing address gets an obfuscated "user" back and no email is revealed.
      if (had) return send(res, 200, { ...userJson(had), identities: [] });
      const [u] = await sql`insert into local_auth.users (id, email, password_hash, confirmed_at, user_metadata)
        values (${crypto.randomUUID()}, ${email}, ${hash(b.password)}, ${AUTOCONFIRM ? sql`now()` : null}, ${sql.json(b.data ?? {})}) returning *`;
      if (AUTOCONFIRM) return send(res, 200, await session(u));
      await mail(u, "signup", q.searchParams.get("redirect_to") ?? b.redirect_to, b.code_challenge);
      const [fresh] = await sql`select * from local_auth.users where id = ${u.id}`;
      return send(res, 200, userJson(fresh));
    }
    if (path === "/verify" && req.method === "GET") {
      const [t] = await sql`update local_auth.tokens set used = true where token = ${q.searchParams.get("token") ?? ""} and not used returning *`;
      const to = new URL(q.searchParams.get("redirect_to") ?? t?.redirect_to ?? "http://localhost:3000/auth/callback");
      if (!t) {
        to.searchParams.set("error", "access_denied"); to.searchParams.set("error_code", "otp_expired"); to.searchParams.set("error_description", "Email link is invalid or has expired");
        res.writeHead(303, { location: to.toString() }); return res.end();
      }
      await sql`update local_auth.users set confirmed_at = coalesce(confirmed_at, now()) where id = ${t.user_id}`;
      const code = crypto.randomUUID();
      await sql`insert into local_auth.tokens (token, kind, user_id, code_challenge) values (${code}, 'pkce', ${t.user_id}, ${t.code_challenge})`;
      to.searchParams.set("code", code);
      res.writeHead(303, { location: to.toString() });
      return res.end();
    }
    if (path === "/verify" && req.method === "POST") {
      const b = await bodyOf(req);
      const [t] = await sql`update local_auth.tokens set used = true where token = ${String(b.token_hash ?? "")} and not used returning *`;
      if (!t) return err(res, 403, "otp_expired", "Email link is invalid or has expired");
      const [u] = await sql`update local_auth.users set confirmed_at = coalesce(confirmed_at, now()) where id = ${t.user_id} returning *`;
      return send(res, 200, await session(u));
    }
    if (path === "/token" && req.method === "POST") {
      const b = await bodyOf(req);
      const grant = q.searchParams.get("grant_type");
      if (grant === "password") {
        const [u] = await sql`select * from local_auth.users where email = ${String(b.email ?? "").toLowerCase().trim()}`;
        if (!u || !checkPw(String(b.password ?? ""), u.password_hash)) return err(res, 400, "invalid_credentials", "Invalid login credentials");
        if (!u.confirmed_at) return err(res, 400, "email_not_confirmed", "Email not confirmed");
        return send(res, 200, await session(u));
      }
      if (grant === "refresh_token") {
        const [r] = await sql`update local_auth.refresh set revoked = true where token = ${String(b.refresh_token ?? "")} and not revoked returning *`;
        if (!r) return err(res, 400, "refresh_token_not_found", "Invalid Refresh Token: Refresh Token Not Found");
        const [u] = await sql`select * from local_auth.users where id = ${r.user_id}`;
        const refresh = crypto.randomBytes(24).toString("base64url");
        await sql`insert into local_auth.refresh (token, user_id, session_id) values (${refresh}, ${u.id}, ${r.session_id})`;
        return send(res, 200, { access_token: jwt(u, r.session_id), token_type: "bearer", expires_in: TTL, expires_at: Math.floor(Date.now() / 1000) + TTL, refresh_token: refresh, user: userJson(u) });
      }
      if (grant === "pkce") {
        const [t] = await sql`update local_auth.tokens set used = true where token = ${String(b.auth_code ?? "")} and kind = 'pkce' and not used returning *`;
        if (!t) return err(res, 400, "flow_state_not_found", "invalid flow state, no valid flow state found");
        const challenge = crypto.createHash("sha256").update(String(b.code_verifier ?? "")).digest("base64url");
        if (t.code_challenge && t.code_challenge !== challenge) return err(res, 400, "bad_code_verifier", "code challenge does not match previously saved code verifier");
        const [u] = await sql`select * from local_auth.users where id = ${t.user_id}`;
        return send(res, 200, await session(u));
      }
      return err(res, 400, "unsupported_grant_type", "Unsupported grant type");
    }
    if (path === "/user" && (req.method === "GET" || req.method === "PUT")) {
      const a = await userFromAuth(req);
      if (!a) return err(res, 403, "bad_jwt", "invalid JWT: unable to parse or verify signature");
      if (req.method === "PUT") {
        const b = await bodyOf(req);
        if (b.password) await sql`update local_auth.users set password_hash = ${hash(b.password)}, updated_at = now() where id = ${a.u.id}`;
        if (b.data) await sql`update local_auth.users set user_metadata = user_metadata || ${sql.json(b.data)}, updated_at = now() where id = ${a.u.id}`;
      }
      const [u] = await sql`select * from local_auth.users where id = ${a.u.id}`;
      return send(res, 200, userJson(u));
    }
    if (path === "/logout" && req.method === "POST") {
      const a = await userFromAuth(req);
      if (a) {
        if ((q.searchParams.get("scope") ?? "global") === "global") await sql`update local_auth.refresh set revoked = true where user_id = ${a.u.id}`;
        else await sql`update local_auth.refresh set revoked = true where session_id = ${a.claims.session_id}`;
      }
      return send(res, 204);
    }
    if ((path === "/resend" || path === "/recover") && req.method === "POST") {
      const b = await bodyOf(req);
      const [u] = await sql`select * from local_auth.users where email = ${String(b.email ?? "").toLowerCase().trim()}`;
      if (u) await mail(u, path === "/resend" ? "signup" : "recovery", q.searchParams.get("redirect_to") ?? b.options?.emailRedirectTo ?? b.redirect_to, b.code_challenge);
      return send(res, 200, {});
    }
    return err(res, 404, "not_found", `local-auth fixture: ${req.method} ${path} isn't implemented`);
  } catch (e) {
    console.error("local-auth:", e);
    return err(res, 500, "unexpected_failure", "local-auth fixture error");
  }
}).listen(PORT, "127.0.0.1", () => console.log(`local-auth (TEST FIXTURE, not Supabase) on ${BASE}; mailbox: ${BASE}/__local/mailbox?email=…`));
