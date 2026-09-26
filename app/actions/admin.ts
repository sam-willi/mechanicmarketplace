"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getRepo } from "@/lib/data";
import { getSession, isStaff } from "@/lib/session";
import { orBack } from "@/lib/lifecycle-action";
import type { SupportReport } from "@/lib/domain/types";

const STATUSES: SupportReport["status"][] = ["open", "in_review", "resolved"];

/** Staff work a report entirely in the app: reply, change its status. The reporter sees both on their help page. */
export async function updateSupportCase(reportId: string, formData: FormData) {
  const repo = await getRepo();
  const s = await getSession();
  if (!isStaff(s)) redirect("/login?next=/admin/support");
  const status = STATUSES.find((x) => x === formData.get("status"));
  const reply = String(formData.get("reply") ?? "");
  const back = `/admin/support/${reportId}`;
  await orBack(back, () => repo.updateSupportCase(reportId, s.userId, { status, reply }));
  revalidatePath("/admin/support");
  redirect(`${back}?saved=1`);
}
