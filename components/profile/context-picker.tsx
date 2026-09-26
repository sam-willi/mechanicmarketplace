import { REPAIR_LABEL } from "@/lib/domain/provenance";
import { REPAIR_CATEGORIES, VEHICLE_MAKES } from "@/lib/domain/types";

/**
 * Turns the profile contextual without JavaScript: a GET form that re-renders
 * the page leading with evidence for this car and this repair.
 */
export function ContextPicker({ slug, firstName }: { slug: string; firstName: string }) {
  return (
    <form action={`/mechanics/${slug}`} method="get" className="sheet px-3.5 py-3">
      <p className="text-[0.9375rem] font-semibold text-ink">Has {firstName} done your repair on your car?</p>
      <div className="mt-2 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2">
        <label className="sr-only" htmlFor="ctx-make">
          Make
        </label>
        <select id="ctx-make" name="make" className="input min-h-11 py-1 text-[0.9375rem]" defaultValue="">
          <option value="">Any make</option>
          {VEHICLE_MAKES.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <label className="sr-only" htmlFor="ctx-repair">
          Repair
        </label>
        <select id="ctx-repair" name="repair" className="input min-h-11 py-1 text-[0.9375rem]" defaultValue="">
          <option value="">Any repair</option>
          {REPAIR_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {REPAIR_LABEL[c]}
            </option>
          ))}
        </select>
        <button type="submit" className="btn btn-line min-h-11 px-3 text-sm">
          Check
        </button>
      </div>
    </form>
  );
}
