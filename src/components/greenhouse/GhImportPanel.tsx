"use client";

import { useState } from "react";
import GhImportForm from "./GhImportForm";
import type { CycleDraft, ImportLogRow, LogKind } from "@/lib/greenhouse/production";

/** Кнопка «Загрузить из книги» и сама форма под ней — на обзоре и в журналах. */
export default function GhImportPanel({
  farm,
  today,
  only,
  label = "Загрузить книгу агронома",
  open: initiallyOpen = false,
  listIds,
  importRows,
  importCycles,
}: {
  farm: string;
  today: string;
  only?: LogKind;
  label?: string;
  open?: boolean;
  listIds: (log: string, farm: string) => Promise<unknown>;
  importRows: (log: string, farm: string, rows: ImportLogRow[]) => Promise<unknown>;
  importCycles: (farm: string, rows: CycleDraft[]) => Promise<unknown>;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  if (!open)
    return (
      <button type="button" className="btn-secondary !py-1.5" onClick={() => setOpen(true)}>
        {label}
      </button>
    );
  return (
    <div className="w-full">
      <GhImportForm farm={farm} today={today} only={only} listIds={listIds} importRows={importRows} importCycles={importCycles} onClose={initiallyOpen ? undefined : () => setOpen(false)} />
    </div>
  );
}
