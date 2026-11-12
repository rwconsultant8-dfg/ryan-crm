"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveMeetingFocusAction } from "@/app/(app)/clients/actions";
import { MEETING_FOCUS_LIMIT } from "@/lib/meeting";

type Props = { clientId: string; focus: string; savedFocus: string | null };

export default function MeetingFocusForm({ clientId, focus, savedFocus }: Props) {
  const [draft, setDraft] = useState(focus);
  const [message, setMessage] = useState<{ ok: boolean; text: string }>();
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <details>
      <summary>填寫／修改今次重點</summary>
      <form onSubmit={(event) => {
        event.preventDefault();
        if (pending || draft.trim() === focus) return;
        startTransition(async () => {
          try {
            const result = await saveMeetingFocusAction(clientId, draft, savedFocus);
            setMessage({ ok: result.ok, text: result.ok ? "已儲存" : result.error });
            if (result.ok) router.refresh();
          } catch {
            setMessage({ ok: false, text: "未能儲存，請重試。" });
          }
        });
      }}>
        <label className="field">
          <span>今次重點／下一步</span>
          <textarea name="focus" value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={MEETING_FOCUS_LIMIT} disabled={pending} />
        </label>
        <button className="btn btn-sm" type="submit" disabled={pending || draft.trim() === focus}>{pending ? "儲存中…" : "儲存重點"}</button>
        {message && <p className={message.ok ? "notice" : "error"} role={message.ok ? "status" : "alert"}>{message.text}</p>}
      </form>
    </details>
  );
}
