"use client";

/**
 * A submit button that asks first. Used for consequential actions
 * (decline, cancel, complete, send). Uses the browser's own dialog, which is
 * keyboard- and screen-reader-accessible everywhere.
 */
export function ConfirmButton({ message, className, children, disabled }: { message: string; className?: string; children: React.ReactNode; disabled?: boolean }) {
  return (
    <button
      type="submit"
      disabled={disabled}
      className={className}
      onClick={(e) => {
        if (!window.confirm(message)) e.preventDefault();
      }}
    >
      {children}
    </button>
  );
}
