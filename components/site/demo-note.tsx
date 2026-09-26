export function DemoNote({ className = "" }: { className?: string }) {
  return (
    <p className={`text-[0.8125rem] text-ink-3 ${className}`}>
      Demo data: every mechanic, shop, customer and review on this site is fictional.
    </p>
  );
}
