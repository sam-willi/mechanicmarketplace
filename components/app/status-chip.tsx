/** Job/request status label shared by both apps. Action-needed states are inverted so they read first. */
export function StatusChip({ label }: { label: string }) {
  const action = label === "Confirm Completion" || label === "Responses In" || label === "Awaiting Customer" || label === "New" || label === "Pick a New Mechanic";
  const muted = label === "Cancelled" || label === "Declined" || label === "Expired" || label === "Not chosen";
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
