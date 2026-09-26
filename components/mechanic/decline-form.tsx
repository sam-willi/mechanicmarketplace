import { X } from "lucide-react";
import { DECLINE_REASON_LABEL, DECLINE_REASONS } from "@/lib/domain/decline";
import { ConfirmButton } from "@/components/app/confirm-button";

/**
 * Pass on a request, or cancel booked work, with an optional reason. The
 * reason is shared with the customer and steers who they're shown next.
 */
export function DeclineForm({
  action,
  summary,
  note,
  confirm,
  submit,
  danger,
  big,
}: {
  action: (formData: FormData) => void | Promise<void>;
  summary: string;
  note: string;
  confirm: string;
  submit: string;
  danger?: boolean;
  /** A large "Not interested" button instead of a quiet link. */
  big?: boolean;
}) {
  return (
    <details className="group">
      <summary
        className={
          big
            ? `flex min-h-16 w-full cursor-pointer list-none items-center justify-center gap-2 border-2 px-5 text-[1.0625rem] font-bold [&::-webkit-details-marker]:hidden ${
                danger
                  ? "border-alert bg-alert-wash text-alert hover:bg-alert hover:text-white group-open:bg-alert group-open:text-white"
                  : "border-rule bg-sheet text-ink hover:border-ink-3 group-open:border-ink-3"
              }`
            : `min-h-11 cursor-pointer content-center text-[0.875rem] underline underline-offset-2 ${danger ? "text-alert decoration-alert/40" : "text-ink-3 decoration-rule hover:text-ink"}`
        }
      >
        {big ? <X size={22} strokeWidth={2.75} aria-hidden /> : null}
        {summary}
      </summary>
      <form action={action} className="mt-2 space-y-3 border border-rule bg-sheet p-4">
        <fieldset>
          <legend className="text-[0.9375rem] font-bold">
            Why? <span className="font-normal text-ink-3">(optional)</span>
          </legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {DECLINE_REASONS.map((r) => (
              <label
                key={r}
                className="inline-flex min-h-11 cursor-pointer items-center border border-rule bg-sheet px-3 text-[0.875rem] has-[:checked]:border-brand has-[:checked]:bg-brand has-[:checked]:font-semibold has-[:checked]:text-on-brand"
              >
                <input type="radio" name="reason" value={r} className="sr-only" />
                {DECLINE_REASON_LABEL[r]}
              </label>
            ))}
          </div>
        </fieldset>
        <p className="text-[0.8125rem] text-ink-2">{note}</p>
        <ConfirmButton message={confirm} className={`btn min-h-11 ${danger ? "border border-alert bg-sheet text-alert hover:bg-alert-wash" : "btn-quiet"}`}>
          {submit}
        </ConfirmButton>
      </form>
    </details>
  );
}
