import { FLOWER_TYPE_LABELS, compareGrades, formatGrade, getFarmFor } from "./constants";

/**
 * Списание ОБЩИМ КОЛИЧЕСТВОМ — без выбора партии и даты.
 *
 * Просьба склада Есентая: «списание по дате убирать надо, нельзя общее
 * количество посадить? У нас списание было с 24 по 7 число» и «как приёмке
 * нельзя шаблон сделать?». До этого списывали из каждой ПАРТИИ отдельно: найти
 * партию по дате срезки, открыть, вписать. Набралось списание за две недели —
 * это десятки партий по одному сорту.
 *
 * Теперь человек говорит «Балтика, Первая — 300 шт.», а программа сама снимает
 * их с партий этой позиции ОТ СТАРЫХ К СВЕЖИМ (FIFO по дате срезки): именно
 * старый цветок и списывают. Журнал списаний по-прежнему пишется по партиям —
 * строка на партию, — поэтому аналитика и срок хранения ничего не заметят.
 *
 * Все правила — здесь, чистыми функциями (грабли 1.11): форма зовёт их для
 * подсказки, сервер — для запрета.
 */

export interface WriteoffBatch {
  batchId: string;
  flowerType: string;
  variety: string;
  grade: string;
  harvestDate: string;
  quantityRemaining: number;
}

export interface WriteoffLine {
  flowerType: string;
  variety: string;
  grade: string;
  quantity: number;
  reason: string;
}

export interface StockPosition {
  flowerType: string;
  variety: string;
  grade: string;
  stock: number;
}

const FLOWER_ORDER = ["rose", "chrysanthemum", "eustoma"];

export function positionKey(p: { flowerType: string; variety: string; grade: string }): string {
  return `${p.flowerType}|${p.variety.trim().toLowerCase()}|${p.grade.trim().toLowerCase()}`;
}

export function positionLabel(p: { flowerType: string; variety: string; grade: string }): string {
  return `${FLOWER_TYPE_LABELS[p.flowerType] ?? p.flowerType} ${p.variety} · ${formatGrade(p.grade)}`;
}

/** Что вообще лежит на складе — позиции с остатком, в привычном порядке. */
export function stockPositions(batches: WriteoffBatch[], farm: string | null): StockPosition[] {
  const map = new Map<string, StockPosition>();
  for (const b of batches) {
    if (b.quantityRemaining <= 0) continue;
    if (farm && getFarmFor(b.flowerType) !== farm) continue;
    const key = positionKey(b);
    const p = map.get(key) ?? { flowerType: b.flowerType, variety: b.variety, grade: b.grade, stock: 0 };
    p.stock += b.quantityRemaining;
    map.set(key, p);
  }
  return Array.from(map.values()).sort(
    (a, b) =>
      FLOWER_ORDER.indexOf(a.flowerType) - FLOWER_ORDER.indexOf(b.flowerType) ||
      a.variety.localeCompare(b.variety, "ru") ||
      compareGrades(a.flowerType, a.grade, b.grade)
  );
}

export interface WriteoffPart {
  batchId: string;
  quantity: number;
  reason: string;
}

export interface WriteoffPlan {
  /** Сколько снять с какой партии. Пусто, если есть хоть одна ошибка. */
  parts: WriteoffPart[];
  /** По строке на присланную строку: пусто — строка в порядке. */
  errors: string[];
  /** По строке: с каких партий (дата срезки) и сколько — для показа до записи. */
  byLine: { batchId: string; harvestDate: string; quantity: number }[][];
  total: number;
}

/** Причина по умолчанию — как было в форме списания партии. */
export const DEFAULT_WRITEOFF_REASON = "Порча / истёк срок хранения";

export function cleanReason(reason: string | null | undefined, note?: string | null): string {
  const base = String(reason ?? "").replace(/\s+/g, " ").trim().slice(0, 120) || DEFAULT_WRITEOFF_REASON;
  const extra = String(note ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
  return extra ? `${base} · ${extra}` : base;
}

/**
 * Разложить списание по партиям: от самой старой срезки к свежей.
 *
 * Ошибка в любой строке — никакого списания вовсе (`parts` пуст): половина
 * списанного файла хуже, чем ни одного, — потом не понять, что уже снято.
 * Две строки одной позиции складываются и проверяются против остатка вместе.
 */
export function planWriteoffs(input: {
  lines: WriteoffLine[];
  batches: WriteoffBatch[];
  farm: string | null;
  note?: string;
}): WriteoffPlan {
  const errors: string[] = input.lines.map(() => "");
  const byKey = new Map<string, WriteoffBatch[]>();
  for (const b of input.batches) {
    if (b.quantityRemaining <= 0) continue;
    const key = positionKey(b);
    const list = byKey.get(key) ?? [];
    list.push(b);
    byKey.set(key, list);
  }
  // Сколько уже «занято» предыдущими строками той же позиции.
  const taken = new Map<string, number>();
  const plannedLines: { index: number; line: WriteoffLine; key: string }[] = [];

  input.lines.forEach((line, index) => {
    const qty = Number(line.quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      errors[index] = "укажите количество больше нуля";
      return;
    }
    if (!Number.isInteger(qty)) {
      errors[index] = "количество — целое число стеблей";
      return;
    }
    if (input.farm && getFarmFor(line.flowerType) !== input.farm) {
      errors[index] = "это цветок другого производства";
      return;
    }
    const key = positionKey(line);
    const stock = (byKey.get(key) ?? []).reduce((s, b) => s + b.quantityRemaining, 0);
    const already = taken.get(key) ?? 0;
    if (stock === 0) {
      errors[index] = "такой позиции на складе нет";
      return;
    }
    if (already + qty > stock) {
      errors[index] =
        already > 0
          ? `вместе со строкой выше выходит ${already + qty} шт., а на складе ${stock}`
          : `на складе только ${stock} шт.`;
      return;
    }
    taken.set(key, already + qty);
    plannedLines.push({ index, line: { ...line, quantity: qty }, key });
  });

  const byLine: WriteoffPlan["byLine"] = input.lines.map(() => []);
  if (errors.some(Boolean)) return { parts: [], errors, byLine, total: 0 };

  // FIFO: старая срезка первой; при равной дате — по номеру партии, чтобы
  // раскладка не зависела от порядка строк в таблице.
  const left = new Map<string, number>();
  const parts: WriteoffPart[] = [];
  for (const { index, line, key } of plannedLines) {
    const reason = cleanReason(line.reason, input.note);
    const batches = [...(byKey.get(key) ?? [])].sort(
      (a, b) =>
        (a.harvestDate || "9999").localeCompare(b.harvestDate || "9999") ||
        a.batchId.localeCompare(b.batchId)
    );
    let need = line.quantity;
    for (const b of batches) {
      if (need <= 0) break;
      const free = left.has(b.batchId) ? left.get(b.batchId)! : b.quantityRemaining;
      if (free <= 0) continue;
      const q = Math.min(free, need);
      left.set(b.batchId, free - q);
      need -= q;
      byLine[index].push({ batchId: b.batchId, harvestDate: b.harvestDate, quantity: q });
      const same = parts.find((p) => p.batchId === b.batchId && p.reason === reason);
      if (same) same.quantity += q;
      else parts.push({ batchId: b.batchId, quantity: q, reason });
    }
  }
  return { parts, errors, byLine, total: parts.reduce((s, p) => s + p.quantity, 0) };
}
