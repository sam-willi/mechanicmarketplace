import type { Quote } from "./types";
import { usd } from "@/lib/format";

/**
 * One way to total an estimate, used by the mechanic's preview, the written
 * estimate, and the side-by-side comparison, so the numbers always agree.
 */
export function quoteTotals(q: Pick<Quote, "laborCents" | "diagnosticFeeCents" | "travelFeeCents" | "partsIncluded" | "partsEstimateCents">) {
  const fees = q.diagnosticFeeCents + q.travelFeeCents;
  const total = q.laborCents + fees + q.partsEstimateCents;
  return {
    labor: q.laborCents,
    fees,
    parts: q.partsEstimateCents,
    total,
    /** "Parts included" is a fixed price; "billed at cost" means parts can change with receipts. */
    partsLine: q.partsIncluded
      ? `Parts included (${usd(q.partsEstimateCents)})`
      : q.partsEstimateCents
        ? `Parts billed at cost, about ${usd(q.partsEstimateCents)}, with receipts`
        : "Parts billed at cost with receipts (no estimate given)",
    /** Total the customer should plan for. */
    planFor: q.partsIncluded ? usd(total) : `about ${usd(total)}`,
  };
}

/** What's in and out of an estimate, in plain words, for the comparison and the document. */
export function inclusions(q: Pick<Quote, "diagnosticFeeCents" | "travelFeeCents" | "partsIncluded" | "partsEstimateCents" | "serviceMode" | "exclusions">) {
  const included: string[] = ["Labor as described"];
  const notIncluded: string[] = [];
  if (q.diagnosticFeeCents) included.push(`Diagnostic (${usd(q.diagnosticFeeCents)})`);
  else included.push("Diagnostic at no extra charge");
  included.push(q.travelFeeCents ? `Travel (${usd(q.travelFeeCents)})` : "Travel at no charge");
  if (q.partsIncluded) included.push("Parts, at a fixed price");
  else notIncluded.push(q.partsEstimateCents ? `Parts: billed at cost, about ${usd(q.partsEstimateCents)}` : "Parts: billed at cost");
  if (q.exclusions) notIncluded.push(...q.exclusions.split(/\n|;/).map((x) => x.trim()).filter(Boolean));
  notIncluded.push("Anything found during diagnosis (needs a revised estimate you approve)");
  return { included, notIncluded };
}
