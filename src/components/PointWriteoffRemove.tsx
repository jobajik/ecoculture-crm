"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { removePointWriteoffAction } from "@/app/finance/point-actions";
import { unwrap } from "@/lib/actionResult";

export default function PointWriteoffRemove({ writeoffId }: { writeoffId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        className="text-xs text-ink-muted hover:text-status-critical disabled:opacity-50"
        disabled={pending}
        onClick={() => {
          if (!window.confirm("Удалить это списание?")) return;
          setError(null);
          start(async () => {
            try {
              unwrap(await removePointWriteoffAction(writeoffId));
              router.refresh();
            } catch (e) {
              setError(e instanceof Error ? e.message : "Не удалилось");
            }
          });
        }}
      >
        удалить
      </button>
      {error && <span className="ml-2 text-xs text-status-critical">{error}</span>}
    </>
  );
}
