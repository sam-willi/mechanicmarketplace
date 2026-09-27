import Link from "next/link";
import { AlertCircle, AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { STATUS_LABEL } from "@/lib/domain/provenance";
import type { VerificationStatus } from "@/lib/domain/types";
import { Tick, tickForStatus } from "@/components/trust/marks";

const STATUS_TONE: Record<VerificationStatus, string> = {
  verified: "text-carbon",
  pending: "text-ink-2",
  not_submitted: "text-ink-3",
  rejected: "text-alert",
  needs_info: "text-amber",
  expired: "text-alert",
  reverification_required: "text-amber",
};

export function StatusPill({ status }: { status: VerificationStatus }) {
  const tick = status === "needs_info" ? "pending" : tickForStatus(status);
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap text-[0.8125rem] font-semibold ${STATUS_TONE[status]}`}>
      <Tick state={tick} size={14} />
      {STATUS_LABEL[status]}
    </span>
  );
}

export function PageTitle({ title, note, action }: { title: string; note?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 border-b-2 border-ink pb-4">
      <div>
        <h1 className="display text-[2rem] sm:text-[2.5rem]">{title}</h1>
        {note ? <p className="mt-1.5 max-w-[64ch] text-[0.9375rem] text-ink-2">{note}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function Field({
  label,
  children,
  hint,
  className = "",
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="field-label">{label}</span>
      <span className="mt-1 block">{children}</span>
      {hint ? <span className="mt-1 block text-[0.8125rem] text-ink-3">{hint}</span> : null}
    </label>
  );
}

/**
 * The one message block for results, warnings and errors on every screen. Square, 1px, washed by
 * meaning; an icon so meaning never rests on colour alone. Carbon stays reserved for verification.
 */
export function Notice({ tone = "info", children, className = "" }: { tone?: "info" | "warn" | "ok" | "error"; children: React.ReactNode; className?: string }) {
  const cls =
    tone === "error"
      ? "border-alert/50 bg-alert-wash"
      : tone === "warn"
        ? "border-amber/40 bg-amber-wash"
        : tone === "ok"
          ? "border-brand/30 bg-brand-wash"
          : "border-rule bg-sheet";
  const Icon = tone === "error" ? AlertCircle : tone === "warn" ? AlertTriangle : tone === "ok" ? CheckCircle2 : Info;
  const iconCls = tone === "error" ? "text-alert" : tone === "warn" ? "text-amber" : tone === "ok" ? "text-brand" : "text-ink-3";
  return (
    <div role={tone === "error" ? "alert" : tone === "info" ? undefined : "status"} className={`flex gap-2.5 border px-4 py-3 text-[0.9375rem] text-ink ${cls} ${className}`}>
      <Icon size={18} className={`mt-0.5 shrink-0 ${iconCls}`} aria-hidden />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export function EmptyRow({ children }: { children: React.ReactNode }) {
  return <p className="border-b border-rule-soft py-6 text-[0.9375rem] text-ink-3">{children}</p>;
}

export function NeedsPersona({ role }: { role: "mechanic" | "customer" | "admin" }) {
  const label = role === "mechanic" ? "mechanics" : role === "admin" ? "Clutch staff" : "customers";
  return (
    <div className="mx-auto max-w-[560px] px-4 py-20 text-center">
      <h1 className="display text-[2rem]">This page is for {label}.</h1>
      <p className="mt-3 text-ink-2">
        {role === "admin" ? "Log in with a Clutch staff account to continue." : `Log in with a ${role} account to continue.`}
      </p>
      <Link href="/login" className="btn btn-ink mt-6">
        Log in
      </Link>
    </div>
  );
}
