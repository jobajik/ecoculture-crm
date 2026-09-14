"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { FLOWER_TYPE_LABELS } from "@/lib/constants";
import { shelfLifeRefusal, type ShelfLifeDraft } from "@/lib/shelfLifeRules";
import { unwrapValue } from "@/lib/actionResult";

/**
 * Сроки хранения прямо на странице, а не ключами в Google-таблице.
 *
 * Эти числа красят весь склад, считают «запаса хватит на N дней» и решают, что
 * показать просроченным. Держать их за ключами вида `ShelfLifeDays_rose` во
 * вкладке `Settings` значило требовать от владельца знать имена ключей, чтобы
 * поменять решение своего же хозяйства.
 */
export default function ShelfLifeForm({
  days,
  warningPercent,
  save,
}: {
  days: Record<string, number>;
  warningPercent: number;
  save: (draft: ShelfLifeDraft) => Promise<unknown>;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<ShelfLifeDraft>({ days: { ...days }, warningPercent });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  const changed =
    draft.warningPercent !== warningPercent ||
    Object.keys(days).some((k) => draft.days[k] !== days[k]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setDone("");
    const refusal = shelfLifeRefusal(draft);
    if (refusal) {
      setError(refusal);
      return;
    }
    setBusy(true);
    try {
      unwrapValue(await save(draft));
      setDone("Сохранено. Склад и аналитика пересчитаются сразу.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить");
    } finally {
      setBusy(false);
    }
  }

  // noValidate: браузер со своим `min` перехватывал отправку и показывал
  // собственную подсказку, а наш текст («иначе весь этот цветок сразу станет
  // просроченным») до человека не доходил. Объяснять должны мы — браузер не
  // знает, чем плох ноль именно здесь.
  return (
    <form onSubmit={submit} noValidate className="space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {Object.keys(days).map((flowerType) => (
          <div key={flowerType}>
            <label className="label">{FLOWER_TYPE_LABELS[flowerType] ?? flowerType}, дней</label>
            <input
              type="number"
              min={1}
              className="input"
              value={draft.days[flowerType] ?? ""}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  days: { ...draft.days, [flowerType]: Number(e.target.value) },
                })
              }
            />
          </div>
        ))}
        <div>
          <label className="label">Порог жёлтого, %</label>
          <input
            type="number"
            min={10}
            max={100}
            className="input"
            value={draft.warningPercent}
            onChange={(e) => setDraft({ ...draft, warningPercent: Number(e.target.value) })}
          />
        </div>
      </div>

      <p className="text-xs text-ink-muted">
        Партия желтеет, когда прошло столько процентов от её срока, и краснеет, когда срок вышел.
        Сейчас жёлтой роза становится на {Math.round((draft.days.rose ?? 0) * draft.warningPercent / 100)}-й
        день из {draft.days.rose ?? 0}.
      </p>

      {error && (
        <p className="text-sm text-status-critical bg-status-critical/10 rounded-lg px-3 py-2">
          {error}
        </p>
      )}
      {done && (
        <p className="text-sm bg-status-good/10 text-status-good rounded-lg px-3 py-2">{done}</p>
      )}

      <button type="submit" className="btn-primary disabled:opacity-50" disabled={busy || !changed}>
        {busy ? "Сохраняю…" : changed ? "Сохранить сроки" : "Изменений нет"}
      </button>
    </form>
  );
}
