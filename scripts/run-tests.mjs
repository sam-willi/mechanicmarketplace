// Runs tests/*.test.ts with tsx. Tests always use the in-memory store:
// DATABASE_URL (and Supabase keys) are removed so nothing touches real data.
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";

const files = readdirSync("tests").filter((f) => f.endsWith(".test.ts")).map((f) => `tests/${f}`);
const env = { ...process.env, NODE_ENV: "test", CLUTCH_ADMIN_EMAILS: "staff@example.test" };
for (const k of ["DATABASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY"]) delete env[k];
const r = spawnSync("npx", ["tsx", "--conditions", "react-server", "--test", ...files], { stdio: "inherit", env });
process.exit(r.status ?? 1);
