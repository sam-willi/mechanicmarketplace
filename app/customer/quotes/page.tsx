import { redirect } from "next/navigation";

/** Estimates live inside the request they answer: Request → Responses → Selected mechanic → Repair. */
export default function CustomerQuotes() {
  redirect("/customer/requests");
}
