"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { importChatAction } from "@/app/clients/leads/talk-actions";
import { unwrapValue } from "@/lib/actionResult";
import { MAX_IMPORT_MESSAGES, parseWhatsAppExport, type ParsedExport } from "@/lib/whatsappExport";
import { formatMoment } from "@/lib/formatDate";

/**
 * Загрузка переписки из «Экспорта чата» WhatsApp: файл .txt (Android) или .zip
 * (iPhone) либо вставленный текст. Разбирается здесь же, в браузере: человек
 * видит, сколько сообщений и кто в них пишет, и отмечает, кто из авторов — «мы».
 * Имя менеджера отмечается само, если совпадает.
 */
export default function ChatImportForm({
  leadId,
  managerName,
  aiReady,
}: {
  leadId: string;
  managerName: string;
  aiReady: boolean;
}) {
  const router = useRouter();
  const [parsed, setParsed] = useState<ParsedExport | null>(null);
  const [ours, setOurs] = useState<string[]>([]);
  const [paste, setPaste] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  function take(text: string) {
    setError(null);
    setDone(null);
    const p = parseWhatsAppExport(text);
    if (p.messages.length === 0) {
      setParsed(null);
      setError("Сообщений не нашлось. Нужен файл из WhatsApp: чат → Ещё → Экспорт чата → Без медиафайлов.");
      return;
    }
    setParsed(p);
    const first = managerName.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
    setOurs(
      p.authors
        .map((a) => a.name)
        .filter((n) => (first && n.toLowerCase().includes(first)) || /ecoculture|экокультур/i.test(n))
    );
  }

  async function onFile(file: File) {
    setError(null);
    try {
      if (/\.zip$/i.test(file.name) || file.type.includes("zip")) {
        const { default: JSZip } = await import("jszip");
        const zip = await JSZip.loadAsync(await file.arrayBuffer());
        const names = Object.keys(zip.files).filter((n) => /\.txt$/i.test(n));
        const pick = names.find((n) => /_chat\.txt$/i.test(n)) ?? names[0];
        if (!pick) throw new Error("В архиве нет текстового файла переписки.");
        take(await zip.files[pick].async("string"));
      } else {
        take(await file.text());
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось прочитать файл");
    }
  }

  async function save() {
    if (!parsed) return;
    setBusy(true);
    setError(null);
    try {
      const lines = parsed.messages.slice(-MAX_IMPORT_MESSAGES);
      const r = unwrapValue(await importChatAction(leadId, lines, ours, aiReady));
      setDone(
        `Загружено новых сообщений: ${r.added} из ${r.total}.` + (r.analyzed ? " Разбор готов — смотрите выше." : "")
      );
      if (r.analysisError) setError(`Переписка сохранена, но разбор не получился: ${r.analysisError}. Нажмите «Разобрать переписку» выше.`);
      setParsed(null);
      setPaste("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось загрузить");
    } finally {
      setBusy(false);
    }
  }

  const first = parsed?.messages[0];
  const last = parsed?.messages[parsed.messages.length - 1];

  return (
    <details className="rounded-lg border border-line-hairline group">
      <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium list-none flex items-center justify-between gap-2">
        <span>Загрузить переписку из WhatsApp</span>
        <span className="text-ink-muted group-open:rotate-90 transition-transform">›</span>
      </summary>
      <div className="px-3 pb-3 space-y-3 text-sm">
        <p className="text-ink-secondary">
          В телефоне откройте чат с клиентом → «Ещё» (⋮) → «Экспорт чата» → «Без медиафайлов» и отправьте файл себе. На
          iPhone: имя контакта → «Экспорт чата». Подойдёт и личный WhatsApp менеджера.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <label className="btn-secondary cursor-pointer">
            Выбрать файл (.txt или .zip)
            <input
              type="file"
              accept=".txt,.zip,text/plain,application/zip"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onFile(f);
                e.target.value = "";
              }}
            />
          </label>
          <span className="text-ink-muted">или вставьте текст:</span>
        </div>
        <textarea
          className="input min-h-[70px] font-mono text-xs"
          placeholder="26.09.2026, 14:05 - Айгуль: Здравствуйте, есть хризантема?"
          value={paste}
          onChange={(e) => setPaste(e.target.value)}
          onBlur={() => paste.trim() && take(paste)}
        />

        {parsed && (
          <div className="rounded-lg bg-surface-plane p-3 space-y-2">
            <div>
              Найдено сообщений: <b>{parsed.messages.length}</b>
              {first && last && (
                <span className="text-ink-muted">
                  {" "}
                  · с {formatMoment(first.at)} по {formatMoment(last.at)}
                </span>
              )}
              {parsed.messages.length > MAX_IMPORT_MESSAGES && (
                <span className="text-ink-muted"> · загрузим последние {MAX_IMPORT_MESSAGES}</span>
              )}
            </div>
            <div className="text-xs text-ink-muted">Отметьте, кто пишет от нас (менеджер):</div>
            <div className="flex flex-wrap gap-1.5">
              {parsed.authors.map((a) => {
                const on = ours.includes(a.name);
                return (
                  <button
                    key={a.name}
                    type="button"
                    onClick={() => setOurs(on ? ours.filter((x) => x !== a.name) : [...ours, a.name])}
                    className={clsx(
                      "rounded-full border px-3 py-1",
                      on ? "border-accent bg-accent/10 font-medium" : "border-line-hairline text-ink-secondary"
                    )}
                  >
                    {on ? "✓ " : ""}
                    {a.name} <span className="text-ink-muted">· {a.count}</span>
                  </button>
                );
              })}
            </div>
            <button type="button" className="btn-primary" disabled={busy || ours.length === 0} onClick={save}>
              {busy ? (aiReady ? "Загружаю и разбираю…" : "Загружаю…") : aiReady ? "Загрузить и разобрать" : "Загрузить"}
            </button>
          </div>
        )}
        {error && <p className="text-status-critical">{error}</p>}
        {done && <p className="text-status-good">{done}</p>}
      </div>
    </details>
  );
}
