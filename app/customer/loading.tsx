/** Shown while a customer page loads: the page's shape, no spinner. */
export default function Loading() {
  return (
    <div className="animate-pulse space-y-6 motion-reduce:animate-none" aria-busy="true" aria-label="Loading">
      <div className="h-9 w-2/3 max-w-[28rem] bg-rule-soft" />
      <div className="h-4 w-1/2 max-w-[20rem] bg-rule-soft" />
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="h-28 bg-rule-soft" />
        <div className="h-28 bg-rule-soft" />
      </div>
      <div className="h-40 bg-rule-soft" />
    </div>
  );
}
