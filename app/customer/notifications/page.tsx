import type { Metadata } from "next";
import { ready, repo } from "@/lib/data";
import { getSession } from "@/lib/session";
import { NotificationsList } from "@/components/app/notifications-list";

export const metadata: Metadata = { title: "Notifications" };

export default async function CustomerNotifications() {
  await ready();
  const s = await getSession();
  if (s.role !== "customer") return null;
  return <NotificationsList items={repo.listNotifications(s.userId, "customer")} mode="customer" />;
}
