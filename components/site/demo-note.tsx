export function DemoNote({ className = "" }: { className?: string }) {
  return (
    <p className={`text-[0.8125rem] text-ink-3 ${className}`}>
      Demo profile: this mechanic, their work and their reviews are fictional test data.
    </p>
  );
}
