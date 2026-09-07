"use server";

import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { authOptions } from "@/lib/auth";
import {
  saveHarvestForecast,
  type HarvestForecastInput,
} from "@/lib/repo/harvestForecast";
import { listVarietiesByType } from "@/lib/repo/varieties";
import { parseForecastWorkbook, type ForecastParseResult, type ParsedForecastRow } from "@/lib/excel";
import {
  FLOWER_TYPE_LABELS,
  ROLES,
  farmLabel,
  flowerTypesForFarm,
  getFarmFor,
  getGradesFor,
  isValidPeriod,
  isValidWeekCode,
} from "@/lib/constants";

/**
 * Прогноз ведут агрономы (и администратор). Агроном привязан к производству
 * колонкой Farm: он видит и пишет только свой цветок. Администратор — по всем.
 */
async function requireAgronomist(): Promise<{ email: string; farm: string | null }> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) throw new Error("Не авторизован");
  const role = session.user.role;
  if (role !== ROLES.AGRONOMIST && role !== ROLES.ADMIN) {
    throw new Error("Недостаточно прав: прогноз срезки ведёт агроном");
  }
  return {
    email: session.user.email.toLowerCase(),
    farm: role === ROLES.ADMIN ? null : session.user.farm ?? null,
  };
}

/**
 * Серверная проверка производства. Прятать чужой цветок в интерфейсе мало:
 * запрос можно послать и в обход страницы.
 */
function assertOwnFlowerType(farm: string | null, flowerType: string) {
  if (!farm) return;
  if (getFarmFor(flowerType) !== farm) {
    throw new Error(
      `${FLOWER_TYPE_LABELS[flowerType] ?? flowerType} относится к производству ` +
        `«${farmLabel(getFarmFor(flowerType))}», а вы отвечаете за «${farmLabel(farm)}»`
    );
  }
}

export async function saveForecastAction(period: string, rows: HarvestForecastInput[]) {
  const { email, farm } = await requireAgronomist();
  // period — код недели: прогноз ведётся понедельно.
  if (!isValidWeekCode(period)) throw new Error("Неверная неделя");

  const catalog = await listVarietiesByType();

  const cleaned: HarvestForecastInput[] = rows.map((row) => {
    const flowerType = (row.flowerType || "").trim();
    const variety = (row.variety || "").trim();
    const grade = (row.grade || "").trim();

    assertOwnFlowerType(farm, flowerType);

    if (!(catalog[flowerType] ?? []).includes(variety)) {
      throw new Error(`Сорт «${variety}» не найден в справочнике`);
    }
    if (!getGradesFor(flowerType).includes(grade)) {
      throw new Error(`Недопустимая длина/категория: «${grade}»`);
    }

    const stems = Number(row.targetStems);
    if (!Number.isFinite(stems) || stems < 0) {
      throw new Error(`${variety} ${grade}: количество не может быть отрицательным`);
    }
    if (stems > 100_000_000) throw new Error(`${variety} ${grade}: слишком большое количество`);

    return { period, flowerType, variety, grade, targetStems: Math.round(stems) };
  });

  const result = await saveHarvestForecast(cleaned, email);

  revalidatePath("/forecast");
  return result;
}

/**
 * Читает загруженный файл и возвращает разобранные строки с пометками об
 * ошибках. Ничего не записывает: сначала агроном смотрит, что распозналось.
 */
export async function parseForecastFileAction(formData: FormData): Promise<ForecastParseResult> {
  const { farm } = await requireAgronomist();

  const file = formData.get("file");
  if (!file || typeof file === "string") {
    return { rows: [], validCount: 0, errorCount: 0, fatalError: "Файл не получен" };
  }

  const month = String(formData.get("month") ?? "");
  const defaultWeek = String(formData.get("defaultWeek") ?? "");
  if (!isValidPeriod(month)) {
    return { rows: [], validCount: 0, errorCount: 0, fatalError: "Не понял, за какой месяц файл" };
  }

  const catalog = await listVarietiesByType();
  const buffer = await (file as File).arrayBuffer();
  return parseForecastWorkbook(
    buffer,
    catalog,
    flowerTypesForFarm(farm),
    month,
    isValidWeekCode(defaultWeek) ? defaultWeek : ""
  );
}

/**
 * Записывает разобранные строки файла. Неделю каждая строка несёт сама: в файле
 * может быть сразу весь месяц, поэтому пишем по неделям, группируя вызовы.
 */
export async function importForecastAction(rows: ParsedForecastRow[]) {
  const valid = rows.filter((r) => !r.error && r.variety && r.grade && r.week);
  if (valid.length === 0) return { updated: 0, created: 0, totalStems: 0 };

  const byWeek = new Map<string, ParsedForecastRow[]>();
  for (const row of valid) {
    const list = byWeek.get(row.week) ?? [];
    list.push(row);
    byWeek.set(row.week, list);
  }

  let updated = 0;
  let created = 0;
  for (const [week, items] of byWeek) {
    const result = await saveForecastAction(
      week,
      items.map((r) => ({
        period: week,
        flowerType: r.flowerType,
        variety: r.variety,
        grade: r.grade,
        targetStems: r.stems,
      }))
    );
    updated += result.updated;
    created += result.created;
  }

  return { updated, created, totalStems: valid.reduce((sum, r) => sum + r.stems, 0) };
}
