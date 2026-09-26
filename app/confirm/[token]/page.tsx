import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getRepo, needsFor } from "@/lib/data";
import { monthYear } from "@/lib/format";
import { Wordmark } from "@/components/brand/wordmark";
import { Tick } from "@/components/trust/marks";
import { PhotoPrint } from "@/components/profile/photo";

export const metadata: Metadata = { title: "Confirm a repair", robots: { index: false } };

export default async function ConfirmPage({ params }: { params: Promise<{ token: string }> }) {
  const repo = await getRepo();
  const { token } = await params;
  // Anyone holding the private link: that one confirmation, its repair and mechanic's public profile.
  await (await needsFor({ staff: false })).confirmation(token);
  const found = repo.getConfirmationByToken(token);
  if (!found) notFound();
  const { confirmation: c, repair: r, mechanic: m } = found;
  const initials = m.displayName.split(" ").map((x) => x[0]).join("");

  async function respond(formData: FormData) {
    "use server";
    const answer = formData.get("answer") === "yes" ? "confirmed" : "denied";
    // Its own request: its own repository (the write reads what it needs by token).
    await (await getRepo()).respondToConfirmation(token, answer);
    revalidatePath(`/confirm/${token}`);
  }

  return (
    <div className="min-h-dvh">
      <header className="border-b border-rule">
        <div className="mx-auto flex h-14 max-w-[560px] items-center px-4">
          <Wordmark />
        </div>
      </header>
      <main className="mx-auto max-w-[560px] px-4 pt-8 pb-16">
        {c.response ? (
          <div className="space-y-4">
            <Tick state={c.response === "confirmed" ? "verified" : "blank"} size={28} />
            <h1 className="display text-[2rem]">{c.response === "confirmed" ? "Thanks, that's recorded." : "Thanks for telling us."}</h1>
            <p className="text-[1.0625rem] leading-relaxed text-ink-2">
              {c.response === "confirmed"
                ? `This repair now shows as confirmed by a past customer on ${m.firstName}'s profile. Your name and contact details are never shown.`
                : `We won't show this repair as verified. ${m.firstName} won't see your contact details.`}
            </p>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-4">
              <PhotoPrint photoUrl={m.photoUrl} initials={initials} name={m.displayName} size={64} />
              <div>
                <p className="heading text-[1.25rem]">{m.displayName}</p>
                <p className="text-[0.9375rem] text-ink-2">{m.city} · independent mechanic</p>
              </div>
            </div>
            <h1 className="display mt-8 text-[2rem] sm:text-[2.5rem]">Did {m.firstName} do this repair for you?</h1>
            <p className="mt-3 text-[1rem] leading-relaxed text-ink-2">
              Hi {c.contactName.split(" ")[0]}. {m.firstName} is building a verified record of their work on Clutch and listed a repair on your car. A quick yes or no helps
              other drivers know what&apos;s real.
            </p>
            <div className="sheet mt-6">
              <dl>
                {[
                  ["Vehicle", `${r.year} ${r.make} ${r.model}`],
                  ["Repair", r.title],
                  ["When", monthYear(r.performedOn, true)],
                ].map(([k, v]) => (
                  <div key={k} className="grid grid-cols-[6rem_minmax(0,1fr)] border-b border-rule-soft px-4 py-3 last:border-b-0">
                    <dt className="field-label pt-0.5">{k}</dt>
                    <dd className="font-semibold text-ink">{v}</dd>
                  </div>
                ))}
              </dl>
            </div>
            <form action={respond} className="mt-6 grid gap-3">
              <button name="answer" value="yes" className="btn btn-ink min-h-12 text-[1rem]">
                Yes, {m.firstName} did this repair
              </button>
              <button name="answer" value="no" className="btn btn-quiet min-h-12 text-[1rem]">
                No, or I don&apos;t recognise it
              </button>
            </form>
            <p className="mt-6 text-[0.875rem] leading-relaxed text-ink-3">
              Your name, phone number and email are never shown on the profile. You won&apos;t be asked to create an account. Sent {monthYear(c.sentAt)} at{" "}
              {m.firstName}&apos;s request.
            </p>
          </>
        )}
      </main>
    </div>
  );
}
