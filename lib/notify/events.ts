import type { AppNotification, NotificationKind } from "@/lib/domain/types";

/**
 * Which in-app notifications are material enough to also send an alert, and the generic
 * wording for each. In-app notifications stay the source of truth; an alert only says
 * "something happened, open Clutch". Alerts never include names, cars, addresses, VINs,
 * documents, screening details, prices or message text — only the event and a link.
 *
 * Account email verification and password recovery are sent by Supabase Auth itself and
 * are deliberately not in this catalog (no duplicate or competing emails).
 */
export const DELIVERY_EVENTS = {
  "request.invited": { subject: "New repair request on Clutch", body: "A customer's repair request matches your repairs and area." },
  "request.withdrawn": { subject: "A repair request was withdrawn", body: "A customer withdrew a request that was sent to you." },
  "request.declined": { subject: "Update on your repair request", body: "A mechanic can't take your request. You can send it to someone else in Clutch." },
  "question.asked": { subject: "You have a question on Clutch", body: "Someone asked a question about a repair. Reply in Clutch." },
  "question.answered": { subject: "You have a reply on Clutch", body: "Your question about a repair was answered." },
  "estimate.received": { subject: "You have a new estimate", body: "A mechanic sent you a written estimate. Review it in Clutch." },
  "estimate.revised": { subject: "An estimate was updated", body: "A mechanic revised an estimate you received. Review the new version in Clutch." },
  "estimate.accepted": { subject: "Your estimate was accepted", body: "A customer accepted your estimate and booked you." },
  "estimate.declined": { subject: "A customer chose another option", body: "An estimate you sent was declined." },
  "estimate.reopened": { subject: "An estimate you sent is open again", body: "A customer's booking fell through, so your estimate is open again." },
  "booking.created": { subject: "Your repair is booked", body: "Your booking is confirmed in Clutch." },
  "booking.confirmed": { subject: "Your appointment time is confirmed", body: "The mechanic confirmed the appointment time." },
  "booking.cancelled": { subject: "A booking was cancelled", body: "A booking was cancelled. See the details in Clutch." },
  "reschedule.requested": { subject: "A new time was suggested", body: "A new appointment time was suggested. Accept or decline it in Clutch." },
  "reschedule.decided": { subject: "A reschedule was answered", body: "Your suggested time was answered. See the booking in Clutch." },
  "extra.requested": { subject: "Approval needed for extra work", body: "The mechanic is asking you to approve extra work before doing it." },
  "extra.decided": { subject: "Extra work was answered", body: "The customer answered your request for extra work." },
  "job.marked_complete": { subject: "Please confirm your repair", body: "The mechanic marked your repair complete. Confirm it, or say what isn't finished, in Clutch." },
  "job.reopened": { subject: "A customer says the repair isn't finished", body: "The customer sent the repair back. See what's left in Clutch." },
  "job.confirmed": { subject: "A customer confirmed the repair", body: "The customer confirmed the repair is done." },
  "payment.mismatch": { subject: "Payment notes don't match", body: "What you and the other person recorded about payment doesn't match. Clutch doesn't handle payments; see the details in Clutch." },
  "review.requested": { subject: "How did the repair go?", body: "You can leave a verified review in Clutch." },
  "review.posted": { subject: "You have a new verified review", body: "A customer reviewed a repair you did." },
  "support.update": { subject: "Update on your Clutch report", body: "Clutch staff updated a report you filed. Read it in Clutch." },
} as const;

export type DeliveryEventType = keyof typeof DELIVERY_EVENTS;
export const DELIVERY_EVENT_TYPES = Object.keys(DELIVERY_EVENTS) as DeliveryEventType[];

/** The default event for a notification kind; `null` means in-app only. */
const BY_KIND: Partial<Record<NotificationKind, DeliveryEventType>> = {
  new_opportunity: "request.invited",
  customer_rebooked: "request.invited",
  mechanic_question: "question.asked",
  customer_question: "question.asked",
  customer_answered: "question.answered",
  new_quote: "estimate.received",
  quote_updated: "estimate.revised",
  quote_accepted: "estimate.accepted",
  mechanic_declined: "request.declined",
  job_scheduled: "booking.created",
  appointment_confirmed: "booking.confirmed",
  reschedule_proposed: "reschedule.requested",
  reschedule_answered: "reschedule.decided",
  scope_change_requested: "extra.requested",
  scope_change_answered: "extra.decided",
  repair_completed: "job.marked_complete",
  payment_mismatch: "payment.mismatch",
  review_requested: "review.requested",
  new_review: "review.posted",
  support_update: "support.update",
};

/** The alert a notification would produce, or null (in-app only). An explicit `event` on the notification wins. */
export function eventFor(n: Pick<AppNotification, "kind" | "event">): DeliveryEventType | null {
  if (n.event === "none") return null;
  if (n.event && n.event in DELIVERY_EVENTS) return n.event as DeliveryEventType;
  return BY_KIND[n.kind] ?? null;
}

/** Only paths inside Clutch, made of safe characters; anything else becomes the home page. */
export function safePath(href: string) {
  return /^\/[A-Za-z0-9/_.#?=&-]*$/.test(href) && !href.startsWith("//") ? href : "/";
}

/** The complete alert: generic subject and text plus a link. No personal or repair data. */
export function renderAlert(type: DeliveryEventType, linkPath: string, origin: string) {
  const t = DELIVERY_EVENTS[type];
  const link = `${origin.replace(/\/$/, "")}${safePath(linkPath)}`;
  return {
    subject: t.subject,
    text: `${t.body}\n\nOpen Clutch: ${link}\n\nYou're getting this because email alerts are on in your Clutch account settings. Alerts never include repair details; everything is in Clutch.`,
    link,
  };
}

/** Test and placeholder addresses never go to a real provider. */
export function isTestAddress(email: string) {
  const domain = email.trim().toLowerCase().split("@")[1] ?? "";
  return !domain || /(^|\.)(example\.(com|net|org|test)|test|invalid|localhost|local|example)$/.test(domain) || domain === "clutch.demo" || domain.endsWith(".demo");
}

/** A contact hint that reveals nothing: channel and whether it's verified. */
export function recipientHint(channel: "email" | "sms", verified: boolean) {
  return `${channel}, ${verified ? "verified" : "not verified"}`;
}
