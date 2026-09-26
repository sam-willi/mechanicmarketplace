import "server-only";
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { dbSql, ensureDeliverySchema } from "@/lib/data/store";
import { deliveryConfig } from "./config";
import { providerFromConfig } from "./providers";
import { recipientLoader, runDeliveryOnce } from "./worker";

/** One delivery batch with the configured provider (or none). Used by the CLI and the cron route. */
export async function deliverBatch(batch = 50) {
  await ensureDeliverySchema();
  const cfg = deliveryConfig();
  const sql = dbSql();
  const summary = await runDeliveryOnce({
    sql,
    provider: providerFromConfig(cfg),
    workerId: `${hostname()}-${process.pid}-${randomUUID().slice(0, 8)}`,
    origin: process.env.APP_URL || "http://localhost:3000",
    loadRecipient: recipientLoader(sql),
    batch,
  });
  return { alertsOn: cfg.active, ...summary };
}
