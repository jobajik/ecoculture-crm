/**
 * Исправить ошибочную приёмку: удалить партию или поправить сорт, градацию, количество и дату срезки.
 *
 * 08.10.2026, зав. складом Rose Farm: «эустома от 5.10 внесена дважды — удалите; дайте нам доступ
 * менять, чтобы в следующий раз исправлять самим». Раньше у склада было только списание: оно
 * убирает стебли, но в приходе ошибка оставалась бы навсегда — и в аналитике прихода, и в
 * «Движении за месяц».
 *
 * Править можно только НЕТРОНУТУЮ партию: остаток равен приходу и по ней нет ни одной строки в
 * журналах (отгрузки, списания, выдачи, перемещения в офис, офисной партии от неё). Тронутая партия
 * уже участвует в чужих записях — её исправляют списанием или возвратом, иначе журнал отгрузки
 * будет ссылаться на партию, которой нет. Правят зав. складом своего цветка и админ.
 */
import { getFarmFor, getGradesFor, gradeForVariety } from "./constants";
import type { Batch } from "./types";

export interface BatchJournals {
  shipments: { batchId: string }[];
  writeoffs: { batchId: string }[];
  takeouts: { batchId: string }[];
  moves: { fromBatchId: string; toBatchId: string }[];
  batches: { batchId: string; sourceBatchId: string }[];
}

/** Что уже было с партией — словами. Пусто — партия нетронутая. */
export function batchTouches(batch: Batch, j: BatchJournals): string[] {
  const id = batch.batchId;
  const out: string[] = [];
  const n = (k: number, word: string) => {
    if (k > 0) out.push(`${word}: ${k}`);
  };
  n(j.shipments.filter((s) => s.batchId === id).length, "отгрузки");
  n(j.writeoffs.filter((s) => s.batchId === id).length, "списания");
  n(j.takeouts.filter((s) => s.batchId === id).length, "выдачи");
  n(j.moves.filter((m) => m.fromBatchId === id || m.toBatchId === id).length, "перемещения");
  n(j.batches.filter((b) => b.sourceBatchId === id).length, "партии в офисе");
  if (out.length === 0 && batch.quantityRemaining !== batch.quantityIn) {
    out.push(`остаток ${batch.quantityRemaining} из ${batch.quantityIn}`);
  }
  return out;
}

/** Отказ: кто и какую партию может исправить. Пустая строка — можно. */
export function batchFixRefusal(input: { role: string; farm: string | null; batch: Batch; touches: string[] }): string {
  const { role, farm, batch, touches } = input;
  if (role !== "admin" && role !== "warehouse") return "Исправить приёмку может зав. складом или администратор";
  if (role === "warehouse" && (!farm || getFarmFor(batch.flowerType) !== farm)) return "Это партия другого производства";
  if (batch.store) return "Это партия склада офиса — её возвращают на основной склад перемещением";
  if (!(batch.quantityIn > 0)) return "У партии нет прихода — исправлять нечего";
  if (touches.length) {
    return `По партии уже есть движение (${touches.join(", ")}) — исправить нельзя. Лишнее уберите списанием.`;
  }
  return "";
}

export interface BatchEditInput {
  variety: string;
  grade: string;
  quantity: number;
  harvestDate: string;
}

const MAX_BACK_DAYS = 60;
const MAX_STEMS = 200_000;

function dayDiff(a: string, b: string): number {
  return Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);
}

/**
 * Правка нетронутой партии: что записать в строку. Цветок не меняется (другой цветок — другое
 * производство). Количество пишется и в приход, и в остаток — партия нетронутая.
 */
export function planBatchEdit(
  batch: Batch,
  input: BatchEditInput,
  ctx: { varieties: readonly string[]; today: string }
): { changes: Record<string, string | number>; summary: string } {
  const variety = String(input.variety || "").trim();
  const known = ctx.varieties.find((v) => v.toLowerCase() === variety.toLowerCase());
  if (!known) throw new Error(`Сорта «${variety}» нет в справочнике`);
  const grade = gradeForVariety(batch.flowerType, known, String(input.grade || "").trim());
  if (!getGradesFor(batch.flowerType).includes(grade)) throw new Error(`Неизвестная градация «${grade}»`);
  const q = Number(input.quantity);
  if (!Number.isInteger(q) || q <= 0) throw new Error("Количество — целое число больше нуля");
  if (q > MAX_STEMS) throw new Error("Слишком большое количество — проверьте, нет ли лишнего нуля");
  const date = String(input.harvestDate || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) throw new Error("Укажите дату срезки");
  if (dayDiff(date, ctx.today) > 0) throw new Error("Дата срезки не может быть в будущем");
  if (dayDiff(ctx.today, date) > MAX_BACK_DAYS) throw new Error(`Дата срезки — не раньше чем ${MAX_BACK_DAYS} дней назад`);

  const changes: Record<string, string | number> = {};
  const parts: string[] = [];
  if (known !== batch.variety) {
    changes.Variety = known;
    parts.push(`сорт ${batch.variety} → ${known}`);
  }
  if (grade !== batch.grade) {
    changes.Grade = grade;
    parts.push(`градация ${batch.grade} → ${grade}`);
  }
  if (q !== batch.quantityIn) {
    changes.QuantityIn = q;
    changes.QuantityRemaining = q;
    parts.push(`количество ${batch.quantityIn} → ${q}`);
  }
  if (date !== batch.harvestDate) {
    changes.HarvestDate = date;
    parts.push(`срезка ${batch.harvestDate} → ${date}`);
  }
  if (parts.length === 0) throw new Error("Ничего не изменилось");
  return { changes, summary: parts.join(", ") };
}

/** Строка партии словами — для журнала: партии после удаления уже нет. */
export function batchLine(b: Batch): string {
  return `${b.batchId} · ${b.flowerType} ${b.variety} ${b.grade} · ${b.quantityIn} шт. · срезка ${b.harvestDate}`;
}

/** Ключ «та же приёмка»: день срезки, цветок, сорт, градация, количество. */
export function receiptKey(b: Batch): string {
  return [b.harvestDate, b.flowerType, b.variety.toLowerCase(), b.grade, b.quantityIn].join("|");
}

/**
 * Партии, похожие на повтор приёмки: на основном складе есть другая партия с тем же днём срезки,
 * цветком, сортом, градацией и приходом. Подсказка на странице «Партии», не запрет.
 */
export function likelyDuplicates(batches: Batch[]): Set<string> {
  const groups = new Map<string, string[]>();
  for (const b of batches) {
    if (b.store || !(b.quantityIn > 0)) continue;
    const k = receiptKey(b);
    groups.set(k, [...(groups.get(k) ?? []), b.batchId]);
  }
  const out = new Set<string>();
  for (const ids of groups.values()) if (ids.length > 1) ids.forEach((id) => out.add(id));
  return out;
}
