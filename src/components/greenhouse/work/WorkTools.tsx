"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { unwrap } from "@/lib/actionResult";
import { formatDay } from "@/lib/formatDate";
import type { ImportRow } from "@/lib/payroll/work";
import WorkImportForm from "./WorkImportForm";

/**
 * Служебное выработки во «Записях» (30.10.2026, раньше жило в журнале выработки): загрузка истории из Excel и
 * привязка имён из старой книги к карточкам сотрудников.
 */
export default function WorkTools({
  farm,
  today,
  people,
  unmatched,
  links,
  listIds,
  importRows,
  linkName,
}: {
  farm: string;
  today: string;
  people: { employeeId: string; fullName: string; deptName: string }[];
  unmatched: { name: string; rows: number; last: string }[];
  links: { name: string; employeeId: string }[];
  listIds: (farm: string) => Promise<unknown>;
  importRows: (farm: string, rows: ImportRow[]) => Promise<unknown>;
  linkName: (farm: string, name: string, employeeId: string) => Promise<unknown>;
}) {
  const router = useRouter();
  const [showImport, setShowImport] = useState(false);
  const [showNames, setShowNames] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const onLink = async (name: string, employeeId: string) => {
    setBusy(name);
    setError("");
    try {
      unwrap(await linkName(farm, name, employeeId));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не получилось привязать.");
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-secondary !py-1.5" onClick={() => setShowImport((v) => !v)}>
          {showImport ? "Скрыть загрузку выработки" : "Загрузить книгу выработки"}
        </button>
        {unmatched.length > 0 && (
          <button type="button" className="btn-secondary !py-1.5" onClick={() => setShowNames((v) => !v)}>
            Имена без карточки: {unmatched.length}
          </button>
        )}
      </div>
      {showImport && <WorkImportForm farm={farm} today={today} listIds={listIds} importRows={importRows} onClose={() => setShowImport(false)} />}
      {showNames && (
        <div className="card space-y-2">
          <div className="text-sm">
            <span className="font-medium">Имена из старого учёта без карточки сотрудника.</span>{" "}
            <span className="text-ink-secondary">Привяжите к карточке — все строки с этим именем станут его, и в оплате труда он будет считаться одним человеком.</span>
          </div>
          {error && <div className="text-sm text-[#a12b2b]">{error}</div>}
          <div className="divide-y divide-line-hairline/60">
            {unmatched.map((u) => {
              const current = links.find((l) => l.name.trim().toLowerCase() === u.name.trim().toLowerCase())?.employeeId ?? "";
              return (
                <div key={u.name} className="py-2 flex flex-wrap items-center gap-2 text-sm">
                  <div className="min-w-[14rem] flex-1">
                    <div className="font-medium">{u.name}</div>
                    <div className="text-xs text-ink-muted">
                      {u.rows} {u.rows === 1 ? "строка" : u.rows < 5 ? "строки" : "строк"} · последняя {formatDay(u.last)}
                    </div>
                  </div>
                  <select className="input !w-auto !py-1.5 max-w-[20rem]" value={current} disabled={busy === u.name} onChange={(e) => onLink(u.name, e.target.value)}>
                    <option value="">— выбрать карточку —</option>
                    {people.map((p) => (
                      <option key={p.employeeId} value={p.employeeId}>
                        {p.fullName} · {p.deptName}
                      </option>
                    ))}
                  </select>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
