"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ArrowLeftRight, Check, X } from "lucide-react";
import { switchMode } from "@/app/actions/account";
import type { AppMode } from "@/lib/domain/types";

/** Always-visible switch for dual-role accounts. Keeps your place where the other app has an equivalent page. */
export function ModeSwitch({ to, tone = "light" }: { to: AppMode; tone?: "light" | "dark" }) {
  const path = usePathname();
  return (
    <form action={switchMode.bind(null, to, path)} className="hidden sm:block">
      <button
        title={`Switch to ${to === "mechanic" ? "Mechanic" : "Customer"}`}
        className={`flex min-h-11 min-w-11 items-center justify-center gap-1.5 border px-2.5 text-[0.8125rem] font-semibold ${tone === "dark" ? "border-brand-deep text-sheet hover:bg-brand-deep/60" : "border-rule text-ink hover:border-ink"}`}
        aria-label={`Switch to ${to === "mechanic" ? "Mechanic" : "Customer"} mode`}
      >
        <ArrowLeftRight size={15} aria-hidden />
        <span className="hidden sm:inline">Switch to {to === "mechanic" ? "Mechanic" : "Customer"}</span>
      </button>
    </form>
  );
}

/** "You're now using Clutch as a customer", once, after switching. */
export function SwitchedToast({ mode }: { mode: AppMode | "" }) {
  const [show, setShow] = useState(Boolean(mode));
  const router = useRouter();
  const path = usePathname();
  useEffect(() => {
    if (!mode) return;
    router.replace(path, { scroll: false });
    const t = setTimeout(() => setShow(false), 5000);
    return () => clearTimeout(t);
  }, [mode, path, router]);
  if (!show || !mode) return null;
  return (
    <div role="status" className="fixed inset-x-0 top-16 z-50 mx-auto flex w-fit max-w-[calc(100%-2rem)] items-center gap-2 border border-brand bg-brand px-4 py-2.5 text-[0.9375rem] font-semibold text-sheet shadow-lg motion-safe:animate-[fade-in_.2s_ease-out]">
      <Check size={16} aria-hidden />
      You&apos;re now using Clutch as a {mode}.
      <button type="button" onClick={() => setShow(false)} className="ml-1 grid size-8 place-items-center" aria-label="Dismiss">
        <X size={15} aria-hidden />
      </button>
    </div>
  );
}
