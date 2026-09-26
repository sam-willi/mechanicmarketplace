"use client";

import { useOptimistic, useTransition } from "react";
import { Bookmark } from "lucide-react";
import { toggleSaveMechanic } from "@/app/actions/customer";

export function SaveMechanicButton({ mechanicId, saved }: { mechanicId: string; saved: boolean }) {
  const [optimistic, setOptimistic] = useOptimistic(saved);
  const [, start] = useTransition();
  return (
    <button
      type="button"
      aria-pressed={optimistic}
      onClick={() =>
        start(async () => {
          setOptimistic(!optimistic);
          await toggleSaveMechanic(mechanicId);
        })
      }
      className="btn btn-quiet min-h-11 px-3 text-sm"
    >
      <Bookmark size={16} strokeWidth={1.75} fill={optimistic ? "currentColor" : "none"} aria-hidden />
      {optimistic ? "Saved" : "Save"}
    </button>
  );
}
