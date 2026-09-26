"use client";

import { useState, useTransition } from "react";
import { respondToMechanicQuestion } from "@/app/actions/intake";
import type { RepairMedia } from "@/lib/domain/types";
import { MediaCapture } from "./media-capture";

/** Customer answers a mechanic's question, with photos, video or audio if helpful. */
export function QuestionReply({ requestId, index, firstName }: { requestId: string; index: number; firstName: string }) {
  const [text, setText] = useState("");
  const [media, setMedia] = useState<RepairMedia[]>([]);
  const [pending, start] = useTransition();
  return (
    <form
      className="mt-2 space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(() => respondToMechanicQuestion(requestId, index, text, media));
      }}
    >
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} className="input" placeholder={`Reply to ${firstName}`} aria-label={`Reply to ${firstName}`} />
      <MediaCapture tag="answer" value={media} onChange={setMedia} modes={["photo", "video", "audio"]} compact />
      <button disabled={pending || (!text.trim() && media.length === 0)} className="btn btn-ink min-h-11">
        {pending ? "Sending…" : `Send reply to ${firstName}`}
      </button>
    </form>
  );
}
