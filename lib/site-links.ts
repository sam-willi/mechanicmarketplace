import { demoLoginsEnabled } from "@/lib/supabase/config";

/** Public footer links. The demo is linked only where it exists (CLUTCH_DEMO_LOGINS isn't off); otherwise /demo is a 404. */
export function footerLinks(): { href: string; label: string; note?: string }[] {
  return [
    { href: "/customer/mechanics", label: "Find a Mechanic" },
    { href: "/for-mechanics", label: "For Mechanics" },
    { href: "/how-it-works", label: "How It Works" },
    { href: "/verification", label: "Verification" },
    { href: "/help", label: "Help & safety" },
    { href: "/privacy", label: "Privacy" },
    { href: "/login", label: "Log in" },
    ...(demoLoginsEnabled() ? [{ href: "/demo", label: "Try the demo", note: "(test data)" }] : []),
  ];
}
