/** Job/request status label shared by both apps. Action-needed states are inverted so they read first. */
export function StatusChip({ label, action: act, ended }: { label: string; action?: boolean; ended?: boolean }) {
  const action = act ?? label === "New";
  const muted = ended ?? (label === "Cancelled" || label === "Closed" || label === "Declined" || label === "Expired" || label === "Not chosen");
  return (
    <span
      className={`inline-flex items-center border px-2 py-0.5 text-[0.6875rem] font-extrabold tracking-[0.08em] whitespace-nowrap uppercase ${
        action ? "border-brand bg-brand text-sheet" : muted ? "border-rule text-ink-3" : "border-ink text-ink"
      }`}
    >
      {label}
    </span>
  );
}
