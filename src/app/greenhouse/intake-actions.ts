"use server";

import { revalidatePath } from "next/cache";
import { guard } from "@/lib/actionResult";
import { FARMS } from "@/lib/constants";
import { greenhouseSession } from "@/lib/greenhouse/session";
import { cleanIntakeRow, intakeDay, intakeDuplicate, type IntakeClean, type IntakeDay, type IntakeDraft } from "@/lib/greenhouse/intake";
import { loadIntake, saveIntakeDay } from "@/lib/repo/greenhouse";
import { listVarietiesByType } from "@/lib/repo/varieties";
import { toIsoDate } from "@/lib/sheetDate";
import { forgetReads } from "@/lib/sheets";
import { localDayKey } from "@/lib/timezone";
import { intakeVarietyList } from "@/lib/greenhouse/intakeData";

/**
 * Приёмка Rose Farm: день целиком одной кнопкой. Всё присланное проверяется заново (`cleanIntakeRow`, грабли 1.11),
 * отказ возвращается текстом через `guard()` (грабли 1.13). Пишут те же, кто ведёт записи теплицы (`editsLogs`): админ,
 * зав. складом и агроном Rose Farm, ответственные из «Зарплаты».
 */

export interface IntakeSavePayload {
  rows: IntakeDraft[];
  /** Номера строк дня, которые были на экране: удаляются только они. */
  known: string[];
}

async function saveIntakeDayActionInner(farm: string, date: string, payload: IntakeSavePayload): Promise<{ added: number; changed: number; removed: number; day: IntakeDay }> {
  const { scope, email } = await greenhouseSession({ farm });
  if (!scope) throw new Error("Раздел «Теплица» для вас закрыт.");
  if (!scope.editsLogs) throw new Error("Приёмку ведут зав. складом, агроном и ответственные Rose Farm — у вас просмотр.");
  const f = String(farm ?? "").trim().toLowerCase();
  if (f !== FARMS.ROSE_FARM) throw new Error("Приёмка по характеристикам ведётся только для Rose Farm.");
  if (scope.farmLocked && scope.farmLocked !== f) throw new Error("Это записи другого производства.");
  const today = localDayKey();
  const day = toIsoDate(String(date ?? ""));
  if (!day) throw new Error("Не указан день.");
  if (day > today) throw new Error("Приёмку на будущий день вносить нельзя.");
  const drafts = Array.isArray(payload?.rows) ? payload.rows : [];
  const known = Array.isArray(payload?.known) ? payload.known.map((k) => String(k)) : [];
  if (drafts.length > 1500) throw new Error("За день — не больше 1500 строк.");
  const varieties = intakeVarietyList(await loadIntake(f), await listVarietiesByType());
  const clean: IntakeClean[] = [];
  for (const d of drafts) {
    const { row, error } = cleanIntakeRow(d, day, today, varieties.all);
    if (error) throw new Error(`Не сохранено: ${error}${/[.!?]$/.test(error) ? "" : "."}`);
    if (row) clean.push(row);
  }
  const dup = intakeDuplicate(clean);
  if (dup) throw new Error(`Не сохранено: ${dup}.`);
  const res = await saveIntakeDay(f, day, clean, known, email);
  forgetReads();
  revalidatePath("/greenhouse", "layout");
  return { ...res, day: intakeDay(await loadIntake(f), day) };
}

export async function saveIntakeDayAction(farm: string, date: string, payload: IntakeSavePayload) {
  return guard(() => saveIntakeDayActionInner(farm, date, payload));
}
