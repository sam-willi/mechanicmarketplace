import { AlertTriangle, MapPin } from "lucide-react";
import {
  CODE_NOTE,
  jobStatus,
  mediaCounts,
  onsetLabel,
  parkingLabel,
  urgencyLabel,
  type Tone,
} from "@/lib/domain/intake";
import { findArea } from "@/lib/domain/areas";
import type { RepairRequest, Vehicle } from "@/lib/domain/types";
import { usd } from "@/lib/format";
import { MediaThumb } from "./media-capture";
import { SiteSummary } from "./site-summary";
import { VehicleSpecCard } from "@/components/vehicle/spec-card";
import { customerSummary } from "@/lib/vehicles/spec";
import { siteAssessment } from "@/lib/domain/site";

const TONE: Record<Tone, string> = {
  stop: "border-alert bg-alert-wash text-alert",
  caution: "border-amber bg-amber-wash text-amber",
  ok: "border-ink bg-sheet text-ink",
  neutral: "border-rule bg-sheet text-ink-2",
};

export function StatusBadge({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1.5 border px-2 py-0.5 text-[0.75rem] font-extrabold tracking-[0.08em] uppercase ${TONE[tone]}`}>
      {tone === "stop" ? <AlertTriangle size={13} strokeWidth={2.5} aria-hidden /> : null}
      {children}
    </span>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 border-b border-rule-soft py-3 sm:grid-cols-[9.5rem_minmax(0,1fr)] sm:gap-4">
      <dt className="field-label pt-0.5">{label}</dt>
      <dd className="min-w-0 text-[0.9375rem] text-ink">{children}</dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-0">
      <h3 className="border-b border-ink pb-1.5 text-[0.8125rem] font-extrabold tracking-[0.08em] uppercase">{title}</h3>
      <dl>{children}</dl>
    </section>
  );
}

/**
 * The mechanic-facing summary of a repair request. Structures the customer's
 * evidence; never states a diagnosis. Address and access details stay hidden
 * until `revealPrivate` (the mechanic has been booked).
 */
export function RequestSummary({
  r,
  v,
  distanceMi,
  revealPrivate = false,
  audience = "mechanic",
  showTitle = true,
}: {
  r: RepairRequest;
  v: Vehicle;
  distanceMi?: number;
  revealPrivate?: boolean;
  audience?: "mechanic" | "customer";
  /** Hide the vehicle name when the page heading already shows it. */
  showTitle?: boolean;
}) {
  const status = jobStatus(r);
  const site = siteAssessment(r);
  const area = findArea(r.location.area);
  const counts = mediaCounts(r);
  const L = r.location;

  return (
    <div className="space-y-7">
      {/* Vehicle + status: the two things read first */}
      <div className="space-y-3">
        {showTitle || audience === "mechanic" ? (
          <VehicleSpecCard v={v} spec={r.vehicleSpec ?? v.spec} category={r.repairCategory} audience={audience} revealVin={revealPrivate || audience === "customer"} />
        ) : (
          <p className="tnum text-[0.9375rem] text-ink-2">{customerSummary(v, r.vehicleSpec ?? v.spec)}</p>
        )}
        <div className={`border px-4 py-3 ${TONE[status.tone]}`}>
          <p className="text-[1rem] font-extrabold tracking-[0.06em] uppercase">{status.headline}</p>
          {status.lines.length ? (
            <ul className="mt-1 space-y-0.5 text-[0.9375rem] font-medium text-ink">
              {status.lines.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>

      <Section title="What the car is doing">
        <Row label={audience === "mechanic" ? "In their words" : "In your words"}>
          <p className="leading-relaxed">&ldquo;{r.symptomDescription}&rdquo;</p>
        </Row>
        {r.occurrence.conditions.length || r.occurrence.notes ? (
          <Row label="When">
            {r.occurrence.conditions.join(", ")}
            {r.occurrence.notes ? <span className="block text-ink-2">{r.occurrence.notes}</span> : null}
          </Row>
        ) : null}
        {r.onset.when || r.onset.firstNoticed ? (
          <Row label="Started">
            {onsetLabel(r.onset.when)}
            {r.onset.firstNoticed ? <span className="block text-ink-2">{r.onset.firstNoticed}</span> : null}
          </Row>
        ) : null}
        <Row label="Warning lights">{r.warningLights.length ? r.warningLights.join(", ") : <span className="text-ink-3">Not answered</span>}</Row>
        {r.sounds ? (
          <Row label="Sounds">
            {r.sounds.present === "yes" ? (
              <>
                {r.sounds.kinds.length ? r.sounds.kinds.join(", ") : "Yes"}
                {r.sounds.description ? <span className="block text-ink-2">{r.sounds.description}</span> : null}
              </>
            ) : r.sounds.present === "no" ? (
              "No unusual sound"
            ) : (
              "Not sure"
            )}
          </Row>
        ) : null}
        {r.smells.length ? <Row label="Smells">{r.smells.join(", ")}</Row> : null}
        {r.leaks ? (
          <Row label="Leaks">
            {r.leaks.present === "yes"
              ? [r.leaks.location, r.leaks.color, r.leaks.amount].filter(Boolean).join(" · ") || "Yes"
              : r.leaks.present === "no"
                ? "No visible leak"
                : "Not sure"}
          </Row>
        ) : null}
      </Section>

      {(r.diagnosticCodes.length > 0 || r.priorDiagnosis) && (
        <Section title="Diagnostic info from the customer">
          {r.diagnosticCodes.length ? (
            <Row label="Codes">
              <span className="flex flex-wrap gap-1.5">
                {r.diagnosticCodes.map((c) => (
                  <span key={c} className="tnum border border-ink px-1.5 py-0.5 text-[0.875rem] font-bold">
                    {c}
                  </span>
                ))}
              </span>
              <span className="mt-1.5 block text-[0.8125rem] text-ink-3">Customer-provided diagnostic code. {CODE_NOTE}</span>
            </Row>
          ) : null}
          {r.priorDiagnosis ? (
            <Row label="Another shop">
              <p>{r.priorDiagnosis.said}</p>
              {r.priorDiagnosis.quotedRepair || r.priorDiagnosis.quotedPriceCents ? (
                <p className="text-ink-2">
                  Quoted: {[r.priorDiagnosis.quotedRepair, r.priorDiagnosis.quotedPriceCents ? usd(r.priorDiagnosis.quotedPriceCents) : null].filter(Boolean).join(", ")}
                </p>
              ) : null}
              <p className="mt-1 text-[0.8125rem] text-ink-3">Another shop&apos;s opinion, not verified. You make your own diagnosis.</p>
            </Row>
          ) : null}
        </Section>
      )}

      {(r.recentRepairs.length > 0 || r.modifications || r.customerParts.length > 0) && (
        <Section title="History">
          {r.recentRepairs.length ? (
            <Row label="Recent work">
              <ul className="space-y-1">
                {r.recentRepairs.map((x, i) => (
                  <li key={i}>
                    {x.what}
                    {x.when ? <span className="text-ink-2"> · {x.when}</span> : null}
                    {x.shop ? <span className="text-ink-2"> · {x.shop}</span> : null}
                    {x.notes ? <span className="block text-ink-2">{x.notes}</span> : null}
                  </li>
                ))}
              </ul>
            </Row>
          ) : null}
          {r.modifications ? (
            <Row label="Modifications">
              {r.modifications.kinds.join(", ") || "Yes"}
              {r.modifications.notes ? <span className="block text-ink-2">{r.modifications.notes}</span> : null}
            </Row>
          ) : null}
          {r.customerParts.length ? (
            <Row label="Parts they bought">
              <ul className="space-y-1">
                {r.customerParts.map((p, i) => (
                  <li key={i}>
                    {p.description}
                    {p.brand || p.partNumber ? <span className="text-ink-2"> · {[p.brand, p.partNumber].filter(Boolean).join(" ")}</span> : null}
                  </li>
                ))}
              </ul>
              <span className="mt-1 block text-[0.8125rem] text-ink-3">
                {audience === "mechanic" ? "Your call whether to install customer-supplied parts." : "Each mechanic decides whether to install parts you've bought."}
              </span>
            </Row>
          ) : null}
        </Section>
      )}

      {r.media.length > 0 && (
        <Section title={`Photos, video & audio · ${counts}`}>
          <div className="flex flex-wrap gap-2 pt-3">
            {r.media.map((m) => (
              <MediaThumb key={m.id} m={m} size={104} />
            ))}
          </div>
        </Section>
      )}

      <Section title="Location & access">
        <Row label="Where">
          <span className="inline-flex items-center gap-1">
            <MapPin size={14} className="text-ink-3" aria-hidden />
            {area?.label ?? "Area not given"}
            {distanceMi !== undefined ? ` · ${distanceMi < 1 ? "under a mile" : `${Math.round(distanceMi)} mi`} away` : ""}
          </span>
          <span className="block text-ink-2">
            {L.serviceMode === "mobile" ? `Mobile repair${L.parkingType ? ` · ${parkingLabel(L.parkingType)}` : ""}` : "Customer will bring it to a shop"}
          </span>
        </Row>
        <Row label="Site">
          <SiteSummary a={site} />
        </Row>
        {L.notes && !site.mitigations.length && !site.conflicts.length ? <Row label="Location notes">{L.notes}</Row> : null}
        {L.serviceMode === "mobile" && (
          <Row label="Address & access">
            {revealPrivate ? (
              <>
                {L.address ?? "No address given"}
                {L.accessInstructions ? <span className="block text-ink-2">{L.accessInstructions}</span> : null}
              </>
            ) : (
              <span className="text-ink-2">
                {L.accessAvailable === true ? "Someone will be there to give access. " : L.accessAvailable === false ? "No one will be there; access instructions provided. " : ""}
                {audience === "mechanic" ? "Exact address and access details are shared once you're booked." : "Shared with a mechanic only once you book them."}
              </span>
            )}
          </Row>
        )}
      </Section>

      <Section title="Timing">
        <Row label="How soon">
          <span className={r.urgency === "stranded" ? "font-semibold text-alert" : ""}>{urgencyLabel(r.urgency) ?? "Not given"}</span>
        </Row>
        {r.preferredTimes ? <Row label="Preferred times">{r.preferredTimes}</Row> : null}
      </Section>

      {r.suspectedIssue ? (
        <section className="border border-dashed border-pencil px-4 py-3">
          <p className="field-label text-pencil">{audience === "mechanic" ? "Customer’s suspected issue" : "What you suspect"}</p>
          <p className="mt-1 text-[0.9375rem] text-ink">&ldquo;{r.suspectedIssue}&rdquo;</p>
          <p className="mt-1 text-[0.8125rem] text-pencil">
            {audience === "mechanic" ? "The customer's own guess, not a diagnosis. You diagnose the car." : "Mechanics see this as your guess. They'll diagnose the car themselves."}
          </p>
        </section>
      ) : null}
    </div>
  );
}

