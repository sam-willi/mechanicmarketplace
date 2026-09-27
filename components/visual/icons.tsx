import {
  Activity,
  BatteryCharging,
  Disc3,
  Droplets,
  Gauge,
  KeyRound,
  type LucideIcon,
  MoveVertical,
  Snowflake,
  Thermometer,
  Zap,
} from "lucide-react";
import type { RepairCategory } from "@/lib/domain/types";

/** One consistent icon per repair category, used everywhere a repair type is named. */
export const REPAIR_ICON: Record<RepairCategory, LucideIcon> = {
  brakes: Disc3,
  suspension: MoveVertical,
  cooling: Thermometer,
  starters: KeyRound,
  alternators: BatteryCharging,
  diagnostics: Activity,
  electrical: Zap,
  engine: Gauge,
  ac: Snowflake,
  maintenance: Droplets,
};

export function RepairIcon({ category, size = 16, className = "" }: { category: RepairCategory; size?: number; className?: string }) {
  const Icon = REPAIR_ICON[category];
  return <Icon size={size} strokeWidth={1.9} aria-hidden className={className} />;
}

/** Initials avatar for customers (reviews, customer lists). No stock faces. */
export function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  const initials = name
    .replace(/[^A-Za-z .]/g, "")
    .split(" ")
    .filter(Boolean)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <span className="grid shrink-0 place-items-center bg-brand-tint font-extrabold text-ink-2" style={{ width: size, height: size, fontSize: size * 0.38 }} aria-hidden>
      {initials}
    </span>
  );
}
