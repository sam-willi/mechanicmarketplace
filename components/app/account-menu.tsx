"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeftRight, Bell, Car, ChevronDown, Heart, LifeBuoy, LogOut, Settings } from "lucide-react";
import { signOut, switchMode } from "@/app/actions/account";
import type { AppMode } from "@/lib/domain/types";

/** Account menu. Dual-role accounts switch modes here: one login, two apps. */
export function AccountMenu({
  name,
  mode,
  hasCustomer,
  hasMechanic,
  tone = "light",
}: {
  name: string;
  mode: AppMode;
  hasCustomer: boolean;
  hasMechanic: boolean;
  tone?: "light" | "dark";
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);
  const other: AppMode = mode === "customer" ? "mechanic" : "customer";
  const otherHeld = other === "customer" ? hasCustomer : hasMechanic;
  const initials = name
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-label={`Account: ${name}, ${mode} mode`}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-2 px-1.5 py-1 ${tone === "dark" ? "text-sheet" : "text-ink"}`}
      >
        <span className={`grid size-8 place-items-center text-[0.75rem] font-extrabold ${tone === "dark" ? "bg-sheet text-ink" : "bg-brand text-sheet"}`}>{initials}</span>
        <span className="block text-left leading-tight">
          <span className="hidden text-[0.875rem] font-semibold sm:block">{name.split(" ")[0]}</span>
          <span className={`block text-[0.6875rem] font-bold tracking-[0.06em] uppercase ${tone === "dark" ? "text-[#a9bfb1]" : "text-ink-3"}`}>{mode === "customer" ? "Customer" : "Mechanic"}</span>
        </span>
        <ChevronDown size={14} aria-hidden className="hidden sm:inline" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-50 mt-2 w-64 border border-ink bg-sheet text-ink shadow-[0_16px_40px_-16px_rgba(22,24,29,0.4)]">
          <div className="border-b border-rule-soft px-4 py-3">
            <p className="font-semibold">{name}</p>
            <p className="text-[0.8125rem] text-ink-3">{mode === "customer" ? "Customer mode" : "Mechanic mode"}</p>
          </div>
          <form action={switchMode.bind(null, other, undefined)} className="border-b border-rule-soft">
            <button role="menuitem" className="flex w-full items-center gap-2.5 px-4 py-3 text-left text-[0.9375rem] font-semibold hover:bg-paper">
              <ArrowLeftRight size={16} aria-hidden />
              {otherHeld ? `Switch to ${other === "mechanic" ? "Mechanic" : "Customer"}` : other === "mechanic" ? "Become a mechanic on Clutch" : "Hire a mechanic for your own car"}
            </button>
          </form>
          {mode === "customer" ? (
            <div className="border-b border-rule-soft py-1">
              {(
                [
                  ["/customer/vehicles", "Vehicles", Car],
                  ["/customer/saved", "Saved mechanics", Heart],
                  ["/customer/notifications", "Notifications", Bell],
                ] as const
              ).map(([href, label, Icon]) => (
                <Link key={href} role="menuitem" href={href} className="flex items-center gap-2.5 px-4 py-2.5 text-[0.9375rem] hover:bg-paper" onClick={() => setOpen(false)}>
                  <Icon size={16} aria-hidden /> {label}
                </Link>
              ))}
            </div>
          ) : null}
          <Link role="menuitem" href={mode === "customer" ? "/customer/profile" : "/mechanic/settings"} className="flex items-center gap-2.5 px-4 py-3 text-[0.9375rem] hover:bg-paper" onClick={() => setOpen(false)}>
            <Settings size={16} aria-hidden />
            Settings
          </Link>
          <Link role="menuitem" href={mode === "customer" ? "/customer/help" : "/mechanic/help"} className="flex items-center gap-2.5 px-4 py-3 text-[0.9375rem] hover:bg-paper" onClick={() => setOpen(false)}>
            <LifeBuoy size={16} aria-hidden /> Help &amp; safety
          </Link>
          <form action={signOut}>
            <button role="menuitem" className="flex w-full items-center gap-2.5 px-4 py-3 text-left text-[0.9375rem] text-ink-2 hover:bg-paper">
              <LogOut size={16} aria-hidden /> Log out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
