"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { trackClient } from "@/app/actions/analytics";
import type { EvidenceVariant } from "@/lib/domain/types";

export function QuoteLink({
  href,
  mechanicId,
  variant,
  className = "",
  children = "Request estimate",
}: {
  href: string;
  mechanicId: string;
  variant?: EvidenceVariant;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      onClick={() => void trackClient("quote_requested", { mechanicId, variant, from: "profile" })}
      className={`btn btn-ink ${className}`}
    >
      {children}
      <ArrowRight size={16} strokeWidth={2} aria-hidden />
    </Link>
  );
}
