"use client";

import { useEffect, useState } from "react";

/** Sticky in-page navigation for long profiles. Highlights the section in view. */
export function SectionNav({ items }: { items: { id: string; label: string }[] }) {
  const [active, setActive] = useState(items[0]?.id);
  useEffect(() => {
    const els = items.map((i) => document.getElementById(i.id)).filter(Boolean) as HTMLElement[];
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: "-120px 0px -60% 0px" },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [items]);
  return (
    <nav aria-label="Profile sections" className="sticky top-14 z-20 -mx-4 border-b border-rule bg-paper/95 px-4 backdrop-blur-sm sm:-mx-6 sm:px-6">
      <ul className="flex gap-1 overflow-x-auto [scrollbar-width:none]">
        {items.map((i) => (
          <li key={i.id} className="shrink-0">
            <a
              href={`#${i.id}`}
              aria-current={active === i.id ? "true" : undefined}
              className={`flex min-h-11 items-center border-b-2 px-2.5 text-[0.875rem] whitespace-nowrap ${active === i.id ? "border-ink font-bold text-ink" : "border-transparent text-ink-2 hover:text-ink"}`}
            >
              {i.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
