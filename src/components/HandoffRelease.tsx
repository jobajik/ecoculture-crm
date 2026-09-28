"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { releaseHandoffAction } from "@/app/clients/broadcasts/actions";
import { unwrap } from "@/lib/actionResult";

/** «Ответили сами» — убрать чат из списка переданных, бот снова может отвечать. */
export default function HandoffRelease({ phone }: { phone: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span>
      <button
        type="button"
        className="text-sm text-accent hover:underline"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            try {
              unwrap(await releaseHandoffAction(phone));
              router.refresh();
            } catch (e) {
              setError(e instanceof Error ? e.message : "Не получилось");
            }
          })
        }
      >
        {pending ? "…" : "ответили — вернуть боту"}
      </button>
      {error && <span className="ml-2 text-xs text-status-critical">{error}</span>}
    </span>
  );
}
