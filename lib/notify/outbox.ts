import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";
import type postgres from "postgres";
import type { AppNotification } from "@/lib/domain/types";
import { eventFor, safePath } from "./events";

/**
 * Queue the optional alert for each new in-app notification, inside the SAME database
 * transaction that commits the notification: if that transaction rolls back, no alert
 * exists; if it commits, the alert is durable. Live scope only (the table refuses others).
 * Idempotent per notification: a retried commit can't queue it twice.
 */
export async function enqueueAlerts(tx: postgres.TransactionSql, notifications: AppNotification[]) {
  for (const n of notifications) {
    const type = eventFor(n);
    if (!type) continue;
    const row = {
      scope: "live",
      event_key: `notification:${n.id}:email`,
      event_type: type,
      channel: "email",
      user_id: n.userId,
      audience: n.mode,
      link_path: safePath(n.href),
      source_notification_id: n.id,
    };
    await tx`insert into delivery_outbox ${tx(row)} on conflict (event_key) do nothing`;
  }
}

let ddl: string | undefined;
export function deliverySchemaSql() {
  return (ddl ??= readFileSync(path.join(process.cwd(), "supabase/migrations/0005_delivery.sql"), "utf8"));
}
