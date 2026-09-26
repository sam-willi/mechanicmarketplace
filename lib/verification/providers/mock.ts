import type { ScreeningKind } from "@/lib/domain/types";
import { addMonths, today } from "../lifecycle";
import type { CheckResult, ScreeningProvider, StartCheckInput, StartCheckResult } from "./types";

/**
 * Deterministic stand-in for a real screening vendor. A check "completes" the
 * first time its result is read after starting, which lets the demo show the
 * Pending → Verified transition without a real webhook.
 */
const RESCREEN_MONTHS: Record<ScreeningKind, number> = {
  identity: 36,
  background: 12,
  driving_record: 12,
};

export class MockScreeningProvider implements ScreeningProvider {
  readonly key = "mock";
  readonly kinds: ScreeningKind[] = ["identity", "background", "driving_record"];
  private started = new Map<string, ScreeningKind>();

  async startCheck(input: StartCheckInput): Promise<StartCheckResult> {
    const providerRef = `mock_${input.kind}_${input.mechanicId}_${Date.now().toString(36)}`;
    this.started.set(providerRef, input.kind);
    return {
      provider: this.key,
      providerRef,
      hostedUrl: undefined,
      status: "pending",
    };
  }

  async getResult(providerRef: string): Promise<CheckResult> {
    const kind = this.started.get(providerRef) ?? (providerRef.split("_")[1] as ScreeningKind);
    const completedAt = today();
    return {
      providerRef,
      status: "verified",
      result: "clear",
      completedAt,
      expiresAt: addMonths(completedAt, RESCREEN_MONTHS[kind] ?? 12),
    };
  }

  parseWebhook(payload: unknown): CheckResult | null {
    if (!payload || typeof payload !== "object") return null;
    const p = payload as { ref?: string; outcome?: "clear" | "consider" | "failed" };
    if (!p.ref) return null;
    return {
      providerRef: p.ref,
      status: p.outcome === "clear" ? "verified" : p.outcome === "consider" ? "pending" : "rejected",
      result: p.outcome,
      completedAt: today(),
    };
  }
}
