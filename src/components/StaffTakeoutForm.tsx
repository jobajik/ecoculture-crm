"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { createStaffTakeoutAction } from "@/app/warehouse/actions";
import { FLOWER_TYPE_LABELS, formatGrade } from "@/lib/constants";
import { findSimilarStaff } from "@/lib/staffTakeout";

export interface TakeoutBatchOption {
  batchId: string;
  flowerType: string;
  variety: string;
  grade: string;
  harvestDate: string;
  quantityRemaining: number;
  /** Цена из внутреннего прайса, если она там есть, — только подсказка. */
  suggestedPrice: number;
}

/**
 * Запись выдачи цветка сотруднику в счёт зарплаты.
 *
 * Порядок полей — порядок разговора у холодильника: кому, что, сколько, почём.
 * Фамилия стоит первой, потому что с неё зав. складом и начинает («Разия взяла
 * двадцать шестидесятки»), а не с сорта.
 *
 * Три решения владельца, которые здесь видны:
 *
 * 1. **фамилия вписывается руками**, а не выбирается из справочника: сборщицы и
 *    водители в CRM не заведены. Чтобы учёт «именно по сотрудникам» при этом
 *    не рассыпался на три написания одного человека, поле подсказывает уже
 *    введённые фамилии, а похожее написание вызывает вопрос под полем. Это
 *    подсказка, а не запрет — однофамильцы бывают;
 * 2. **цену вписывает зав. складом.** Внутренняя цена, если она есть в прайсе,
 *    показана рядом как подсказка и подставляется одним нажатием, но сама
 *    собой в поле не лезет: владелец выбрал ручной ввод;
 * 3. партию выбирает человек — сверху самая старая, как и при отгрузке.
 *
 * Цена может остаться пустой: строка всё равно записывается, а сумма по ней
 * будет нулевой и помечена. Не дать записать выдачу из-за неизвестной цены —
 * значит получить незаписанную выдачу и недостачу на складе.
 */
export default function StaffTakeoutForm({
  batches,
  knownNames,
  today,
  defaultDate,
}: {
  batches: TakeoutBatchOption[];
  knownNames: string[];
  today: string;
  defaultDate: string;
}) {
  const router = useRouter();

  const [staffName, setStaffName] = useState("");
  const [date, setDate] = useState(defaultDate);
  const [flowerType, setFlowerType] = useState(batches[0]?.flowerType ?? "");
  const [variety, setVariety] = useState("");
  const [grade, setGrade] = useState("");
  const [batchId, setBatchId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unitPrice, setUnitPrice] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const flowerTypes = useMemo(
    () => Array.from(new Set(batches.map((b) => b.flowerType))),
    [batches]
  );
  const varieties = useMemo(
    () => Array.from(new Set(batches.filter((b) => b.flowerType === flowerType).map((b) => b.variety))).sort((a, b) => a.localeCompare(b, "ru")),
    [batches, flowerType]
  );
  const grades = useMemo(
    () =>
      Array.from(
        new Set(
          batches
            .filter((b) => b.flowerType === flowerType && b.variety === variety)
            .map((b) => b.grade)
        )
      ),
    [batches, flowerType, variety]
  );
  // Партии от старых к свежим: старую отдавать первой. Это порядок, а не
  // запрет — зав. складом видит холодильник, программа нет.
  const options = useMemo(
    () =>
      batches
        .filter((b) => b.flowerType === flowerType && b.variety === variety && b.grade === grade)
        .sort((a, b) => (a.harvestDate < b.harvestDate ? -1 : 1)),
    [batches, flowerType, variety, grade]
  );

  const batch = options.find((b) => b.batchId === batchId) ?? null;
  const qty = Number(quantity) || 0;
  const price = Number(unitPrice) || 0;
  const similar = findSimilarStaff(staffName, knownNames);

  function pickFlower(value: string) {
    setFlowerType(value);
    setVariety("");
    setGrade("");
    setBatchId("");
  }
  function pickVariety(value: string) {
    setVariety(value);
    setGrade("");
    setBatchId("");
  }
  function pickGrade(value: string) {
    setGrade(value);
    setBatchId("");
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setDone(null);

    if (!staffName.trim()) return setError("Укажите, кому выдали");
    if (!batch) return setError("Выберите партию");
    if (!qty || qty <= 0) return setError("Укажите количество");
    if (qty > batch.quantityRemaining) {
      return setError(`В партии осталось ${batch.quantityRemaining} шт.`);
    }
    if (!date) return setError("Укажите дату выдачи");

    setSubmitting(true);
    try {
      await createStaffTakeoutAction({
        date,
        staffName: staffName.trim(),
        batchId: batch.batchId,
        quantity: qty,
        unitPrice: price,
        note: note.trim(),
      });
      setDone(`${staffName.trim()} — ${qty} шт.`);
      // Фамилию и день оставляем: следующей строкой часто идёт тот же человек
      // или тот же день. Сбрасываем то, что точно поменяется.
      setQuantity("");
      setNote("");
      setBatchId("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось записать выдачу");
    } finally {
      setSubmitting(false);
    }
  }

  if (batches.length === 0) {
    return (
      <div className="card text-sm text-ink-secondary">
        На складе нет партий с остатком — выдавать нечего. Сначала оформите приёмку.
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="card space-y-4">
      <div className="grid sm:grid-cols-2 gap-3">
        <label className="text-sm">
          <span className="label">Кому выдали</span>
          <input
            className="input"
            list="staff-names"
            value={staffName}
            onChange={(e) => setStaffName(e.target.value)}
            placeholder="Фамилия и имя"
            autoComplete="off"
          />
          <datalist id="staff-names">
            {knownNames.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
          {similar && (
            <span className="block text-xs text-[#8a5a00] mt-1">
              Раньше писали «{similar}».{" "}
              <button
                type="button"
                className="underline"
                onClick={() => setStaffName(similar)}
              >
                Взять это написание
              </button>
            </span>
          )}
        </label>
        <label className="text-sm">
          <span className="label">Дата выдачи</span>
          <input
            type="date"
            className="input"
            value={date}
            max={today}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
      </div>

      <div className="grid sm:grid-cols-3 gap-3">
        <label className="text-sm">
          <span className="label">Цветок</span>
          <select className="input" value={flowerType} onChange={(e) => pickFlower(e.target.value)}>
            {flowerTypes.map((t) => (
              <option key={t} value={t}>
                {FLOWER_TYPE_LABELS[t] ?? t}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="label">Сорт</span>
          <select className="input" value={variety} onChange={(e) => pickVariety(e.target.value)}>
            <option value="">— выберите —</option>
            {varieties.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="label">Позиция</span>
          <select
            className="input"
            value={grade}
            onChange={(e) => pickGrade(e.target.value)}
            disabled={!variety}
          >
            <option value="">— выберите —</option>
            {grades.map((g) => (
              <option key={g} value={g}>
                {formatGrade(g)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {grade && (
        <label className="text-sm block">
          <span className="label">Партия</span>
          <select className="input" value={batchId} onChange={(e) => setBatchId(e.target.value)}>
            <option value="">— выберите партию —</option>
            {options.map((b, idx) => (
              <option key={b.batchId} value={b.batchId}>
                срезка {formatRu(b.harvestDate)} · остаток {b.quantityRemaining} шт.
                {idx === 0 ? " · самая старая" : ""}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="grid sm:grid-cols-3 gap-3">
        <label className="text-sm">
          <span className="label">
            Количество
            {batch && (
              <span className="text-ink-muted font-normal"> · в партии {batch.quantityRemaining}</span>
            )}
          </span>
          <input
            className="input"
            inputMode="numeric"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value.replace(/[^\d]/g, ""))}
            placeholder="0"
          />
        </label>
        <label className="text-sm">
          <span className="label">Цена за стебель, ₸</span>
          <input
            className="input"
            inputMode="decimal"
            value={unitPrice}
            onChange={(e) => setUnitPrice(e.target.value.replace(/[^\d.,]/g, "").replace(",", "."))}
            placeholder="0"
          />
          {batch && batch.suggestedPrice > 0 && (
            <span className="block text-xs text-ink-muted mt-1">
              внутренняя цена {batch.suggestedPrice.toLocaleString("ru-RU")} ₸ —{" "}
              <button
                type="button"
                className="underline"
                onClick={() => setUnitPrice(String(batch.suggestedPrice))}
              >
                подставить
              </button>
            </span>
          )}
        </label>
        <div className="text-sm">
          <span className="label">К удержанию</span>
          <div
            className={clsx(
              "text-lg font-semibold tabular-nums pt-1.5",
              qty > 0 && price <= 0 ? "text-[#8a5a00]" : ""
            )}
          >
            {qty > 0 && price > 0
              ? `${Math.round(qty * price).toLocaleString("ru-RU")} ₸`
              : qty > 0
                ? "цена не указана"
                : "—"}
          </div>
        </div>
      </div>

      <label className="text-sm block">
        <span className="label">Примечание (не обязательно)</span>
        <input
          className="input"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="например: на праздник"
        />
      </label>

      {error && (
        <div className="text-sm text-status-critical bg-status-critical/10 rounded-lg px-3 py-2">
          {error}
        </div>
      )}
      {done && (
        <div className="text-sm text-status-good bg-status-good/10 rounded-lg px-3 py-2">
          Записано: {done}. Стебли сняты со склада.
        </div>
      )}

      <div>
        <button type="submit" disabled={submitting} className="btn-primary disabled:opacity-50">
          {submitting ? "Записываю…" : "Записать выдачу"}
        </button>
        <p className="text-xs text-ink-muted mt-2">
          Стебли уйдут со склада сразу. Денег по этой записи в кассу не приходит: сумма — это то,
          что бухгалтер удержит из зарплаты.
        </p>
      </div>
    </form>
  );
}

/** «2026-09-08» → «08.09.2026». */
function formatRu(day: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : day;
}
