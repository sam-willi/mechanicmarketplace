import { Camera, ShieldCheck } from "lucide-react";
import type { PublicRepair } from "@/lib/domain/public-profile";
import { REPAIR_LABEL } from "@/lib/domain/provenance";
import { RepairIcon } from "./icons";
import { VehicleGlyph } from "./vehicle-glyph";

const KIND_LABEL: Record<string, string> = {
  before: "Before",
  after: "After",
  parts: "Parts replaced",
  completed: "Completed",
  diagnostic: "Diagnostic",
  vehicle: "Vehicle",
  on_site: "On the job",
};

function when(d: string) {
  return new Date(d).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

/**
 * Recent work as visual evidence. A photo is labelled by where it came from:
 * "Verified repair photo" (attached to a Clutch job the customer confirmed) or
 * "Mechanic-uploaded photo". A repair without a photo shows its category icon
 * and vehicle outline, and says so. We never stand in a stock image.
 */
export function WorkGallery({
  repairs,
  limit = 6,
  compact = false,
  highlight,
}: {
  repairs: PublicRepair[];
  limit?: number;
  compact?: boolean;
  highlight?: (r: PublicRepair) => boolean;
}) {
  const withPhotos = repairs.filter((r) => r.photos.some((p) => p.url));
  const rest = repairs.filter((r) => !r.photos.some((p) => p.url));
  const list = [...withPhotos, ...rest].slice(0, limit);
  if (!list.length) return null;
  return (
    <ul className={`grid gap-2.5 ${compact ? "grid-cols-3" : "grid-cols-2 sm:grid-cols-3"}`}>
      {list.map((r) => (
        <WorkTile key={r.id} r={r} compact={compact} hl={highlight?.(r)} />
      ))}
    </ul>
  );
}

function WorkTile({ r, compact, hl }: { r: PublicRepair; compact: boolean; hl?: boolean }) {
  const photo = r.photos.find((p) => p.url && p.kind === "after") ?? r.photos.find((p) => p.url);
  return (
    <li className={`min-w-0 border bg-sheet ${hl ? "border-ink" : "border-rule"}`}>
      <div className={`relative ${compact ? "aspect-square" : "aspect-[4/3]"} overflow-hidden bg-paper`}>
        {photo ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photo.url} alt={`${KIND_LABEL[photo.kind] ?? "Photo"}: ${r.title}, ${r.year} ${r.make} ${r.model}`} className="size-full object-cover" />
            {!compact && (
              <span
                className={`absolute bottom-1.5 left-1.5 inline-flex items-center gap-1 px-1.5 py-0.5 text-[0.6875rem] font-bold ${
                  photo.verified ? "bg-carbon text-white" : "bg-sheet/95 text-ink-2"
                }`}
              >
                {photo.verified ? <ShieldCheck size={12} aria-hidden /> : <Camera size={12} aria-hidden />}
                {photo.demo ? "Demo photo" : photo.verified ? "Verified repair photo" : "Mechanic-uploaded photo"}
              </span>
            )}
          </>
        ) : (
          <div className="flex size-full flex-col items-center justify-center gap-1.5 text-ink-3" role="img" aria-label={`${r.title} on a ${r.year} ${r.make} ${r.model}. No photo attached.`}>
            <VehicleGlyph model={r.model} width={compact ? 54 : 84} />
            <span className="inline-flex items-center gap-1 text-[0.6875rem] font-bold uppercase tracking-[0.06em]">
              <RepairIcon category={r.category} size={12} /> {REPAIR_LABEL[r.category]}
            </span>
          </div>
        )}
      </div>
      {!compact && (
        <div className="px-2.5 py-2">
          <p className="truncate text-[0.8125rem] font-semibold">{r.title}</p>
          <p className="truncate text-[0.75rem] text-ink-2">
            {r.year} {r.make} {r.model} · {when(r.performedOn)}
          </p>
          {!photo && <p className="mt-0.5 text-[0.6875rem] text-ink-3">No photo on this record</p>}
        </div>
      )}
    </li>
  );
}

/**
 * The most recent matching jobs as a short list: a photo thumbnail when one is
 * attached, otherwise the repair icon. Used on top-pick cards.
 */
export function RecentMatchingWork({ repairs, matching }: { repairs: PublicRepair[]; matching: boolean }) {
  const list = [...repairs].sort((a, b) => (a.performedOn < b.performedOn ? 1 : -1)).slice(0, 3);
  if (!list.length) return null;
  return (
    <div>
      <p className="text-[0.8125rem] font-bold">{matching ? "Most recent matching jobs" : "Most recent verified jobs"}</p>
      <ul className="mt-1.5 divide-y divide-rule-soft border-y border-rule-soft">
        {list.map((r) => {
          const photo = r.photos.find((p) => p.url);
          return (
            <li key={r.id} className="flex items-center gap-3 py-2">
              {photo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={photo.url} alt="" className="size-10 shrink-0 border border-rule object-cover" />
              ) : (
                <span className="grid size-10 shrink-0 place-items-center border border-brand-tint bg-brand-wash text-brand" aria-hidden>
                  <RepairIcon category={r.category} size={17} />
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-[0.875rem] font-semibold">{r.title}</p>
                <p className="truncate text-[0.75rem] text-ink-2">
                  {r.year} {r.make} {r.model} · {when(r.performedOn)}
                </p>
              </div>
              {photo && !photo.verified ? (
                <span className="hidden shrink-0 items-center gap-1 text-[0.6875rem] font-bold text-ink-3 sm:inline-flex">
                  <Camera size={12} aria-hidden /> {photo.demo ? "Demo photo" : "Mechanic-uploaded photo"}
                </span>
              ) : (
                <span className="hidden shrink-0 items-center gap-1 text-[0.6875rem] font-bold text-carbon sm:inline-flex">
                  <ShieldCheck size={12} aria-hidden /> {photo ? "Verified repair photo" : "Verified job"}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * The work gallery on a profile. Every item is tied to its repair record and
 * shows the vehicle, repair, date, what the photo shows, and who supplied it.
 */
export function ProfileGallery({ repairs, firstName }: { repairs: PublicRepair[]; firstName: string }) {
  const items = repairs.flatMap((r) => r.photos.filter((ph) => ph.url).map((ph) => ({ r, ph })));
  if (!items.length) {
    return (
      <div className="flex items-start gap-3 border border-dashed border-rule bg-sheet p-4 text-[0.9375rem] text-ink-2">
        <Camera size={20} className="mt-0.5 shrink-0" aria-hidden />
        <p>
          No photos on {firstName}&apos;s repair records yet. When {firstName} adds before, after or old-part photos to a Clutch job, they appear here, each tied to the
          repair it came from. Clutch never shows stock photos as someone&apos;s work.
        </p>
      </div>
    );
  }
  const source = (ph: PublicRepair["photos"][number]) =>
    ph.demo
      ? { label: "Demo photo", cls: "bg-sheet/95 text-ink-2", icon: Camera }
      : ph.verified ? { label: "Verified repair photo", cls: "bg-carbon text-white", icon: ShieldCheck } : ph.source === "customer" ? { label: "Customer photo", cls: "bg-sheet/95 text-ink", icon: Camera } : { label: "Mechanic-uploaded", cls: "bg-sheet/95 text-ink-2", icon: Camera };
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {items.slice(0, 12).map(({ r, ph }) => {
        const S = source(ph);
        return (
          <li key={ph.id} className="min-w-0 border border-rule bg-sheet">
            <a href={ph.url} target="_blank" rel="noreferrer" className="relative block aspect-[4/3] overflow-hidden bg-paper">
              {ph.video ? (
                <video src={`${ph.url}#t=0.5`} muted preload="metadata" playsInline className="size-full object-cover" aria-label={`${KIND_LABEL[ph.kind] ?? "Video"}: ${r.title}`} />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={ph.url} alt={`${KIND_LABEL[ph.kind] ?? "Photo"}: ${r.title} on a ${r.year} ${r.make} ${r.model}`} className="size-full object-cover" />
              )}
              <span className="absolute top-1.5 left-1.5 bg-ink/85 px-1.5 py-0.5 text-[0.6875rem] font-bold text-sheet">{KIND_LABEL[ph.kind] ?? "Photo"}{ph.video ? " · video" : ""}</span>
              <span className={`absolute bottom-1.5 left-1.5 inline-flex items-center gap-1 px-1.5 py-0.5 text-[0.6875rem] font-bold ${S.cls}`}>
                <S.icon size={12} aria-hidden /> {S.label}
              </span>
            </a>
            <div className="px-2.5 py-2">
              <p className="truncate text-[0.8125rem] font-semibold">{r.title}</p>
              <p className="truncate text-[0.75rem] text-ink-2">
                {r.year} {r.make} {r.model} · {when(r.performedOn)}
              </p>
              {ph.caption ? <p className="truncate text-[0.75rem] text-ink-2">{ph.caption}</p> : null}
              {r.ticket ? <p className="text-[0.6875rem] text-ink-3">Repair record No.{String(r.ticket).padStart(3, "0")}</p> : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
