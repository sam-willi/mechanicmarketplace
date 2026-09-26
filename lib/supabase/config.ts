/** Supabase project settings. Auth runs through Supabase when both are set. */
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
export const authConfigured = () => Boolean(SUPABASE_URL && SUPABASE_KEY);
/** One-click demo accounts (Maya, Derek…). On unless CLUTCH_DEMO_LOGINS=off. */
export const demoLoginsEnabled = () => process.env.CLUTCH_DEMO_LOGINS !== "off";
