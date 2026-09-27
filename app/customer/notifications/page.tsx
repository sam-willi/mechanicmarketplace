import type { Metadata } from "next";
import { getRepo } from "@/lib/data";
import { getSession, needs } from "@/lib/session";
import { paginate, parseCursor } from "@/lib/data/page";
import { NotificationsList } from "@/components/app/notifications-list";
import { Pager } from "@/components/app/pager";

export const metadata: Metadata = { title: "Notifications" };

const PAGE = 50;

export default async function CustomerNotifications({ searchParams }: { searchParams: Promise<{ before?: string }> }) {
  const repo = await getRepo();
  const s = await getSession();
  if (s.role !== "customer") return null;
  const before = parseCursor((await searchParams).before);
  await (await needs(s)).notifications("customer", before, PAGE);
  const { items, next } = paginate(repo.listNotifications(s.userId, "customer"), (n) => n.createdAt, PAGE, before);
  return (
    <>
      <NotificationsList items={items} mode="customer" />
      <Pager href="/customer/notifications" next={next} paged={Boolean(before)} />
    </>
  );
}
