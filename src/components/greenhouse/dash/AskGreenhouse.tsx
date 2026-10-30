"use client";

import { useState } from "react";
import { unwrapValue } from "@/lib/actionResult";

/**
 * «Спросить по данным» (30.10.2026, ТЗ: «какая теплица лучше, где растут потери, сколько ожидается через неделю…»).
 * Ответ — только из настоящих цифр теплицы: сервер собирает их выжимку и даёт модели одну её.
 */
const PRESETS = [
  "Какой блок сейчас лучше всех и какой хуже?",
  "Где растут потери?",
  "Сколько срежем на следующей неделе?",
  "Какие отклонения требуют вмешательства?",
  "Как меняется срезка за последние месяцы?",
];

type Ask = (farm: string, question: string) => Promise<unknown>;

export default function AskGreenhouse({ farm, ask }: { farm: string; ask: Ask }) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<{ q: string; a: string } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function run(q: string) {
    const text = q.trim();
    if (!text || busy) return;
    setBusy(true);
    setError("");
    try {
      const res = unwrapValue(await ask(farm, text)) as { answer: string };
      setAnswer({ q: text, a: res.answer });
      setQuestion("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card !p-4 space-y-3">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <h3 className="font-display font-bold text-[15px]">Спросить по данным</h3>
        <span className="text-xs text-ink-muted">ИИ отвечает только из цифр теплицы</span>
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          run(question);
        }}
      >
        <input className="input flex-1 min-w-0" value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Например: какой сорт даёт больше высшей?" maxLength={400} disabled={busy} />
        <button type="submit" className="btn-primary flex-none" disabled={busy || question.trim().length < 3}>
          {busy ? "Думаю…" : "Спросить"}
        </button>
      </form>
      {!answer && !busy && (
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map((p) => (
            <button key={p} type="button" className="text-xs rounded-full border border-line-hairline px-2.5 py-1 hover:bg-surface-sunk text-ink-secondary" onClick={() => run(p)}>
              {p}
            </button>
          ))}
        </div>
      )}
      {error && <div className="text-sm text-[#a12b2b]">{error}</div>}
      {answer && (
        <div className="rounded-xl bg-surface-sunk px-3.5 py-3 space-y-1.5">
          <div className="text-xs text-ink-muted">{answer.q}</div>
          <div className="text-sm whitespace-pre-line leading-relaxed">{answer.a}</div>
          <button type="button" className="text-xs underline text-ink-muted" onClick={() => setAnswer(null)}>
            другой вопрос
          </button>
        </div>
      )}
    </section>
  );
}
