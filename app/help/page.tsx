import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter, SiteHeader } from "@/components/site/site-header";
import { CommonAnswers, ContactSupport, Protections } from "@/components/help/help-content";

export const metadata: Metadata = { title: "Help & safety" };

export default function HelpPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-[920px] space-y-12 px-4 pt-10 pb-16 sm:px-6">
        <div>
          <h1 className="display text-[2.25rem] sm:text-[3rem]">Help &amp; safety</h1>
          <p className="mt-2 max-w-[62ch] text-ink-2">
            To report a problem with a job,{" "}
            <Link href="/login" className="link">log in</Link> and open Help.
          </p>
        </div>
        <Protections />
        <CommonAnswers area="public" />
        <ContactSupport />
      </main>
      <SiteFooter />
    </>
  );
}
