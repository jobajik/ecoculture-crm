"use server";

import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { authOptions } from "@/lib/auth";
import {
  saveHarvestForecast,
  type HarvestForecastInput,
} from "@/lib/repo/harvestForecast";
import { saveHarvestMix, type HarvestMixInput } from "@/lib/repo/harvestMix";
import { listVarietiesByType } from "@/lib/repo/varieties";
import {
  parseForecastWorkbook,
  type ForecastParseResult,
  type ParsedMixRow,
  type ParsedVarietyRow,
} from "@/lib/excel";
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

function cleanStems(value: unknown, what: string): number {
  const stems = Number(value);
  if (!Number.isFinite(stems) || stems < 0) {
    throw new Error(`${what}: количество не может быть отрицательным`);
  }
  if (stems > 100_000_000) throw new Error(`${what}: слишком большое количество`);
  return Math.round(stems);
}

/** Прогноз по сортам: сорт × неделя. */
export async function saveForecastAction(period: string, rows: HarvestForecastInput[]) {
  const { email, farm } = await requireAgronomist();
  if (!isValidWeekCode(period)) throw new Error("Неверная неделя");

  const catalog = await listVarietiesByType();

  const cleaned: HarvestForecastInput[] = rows.map((row) => {
    const flowerType = (row.flowerType || "").trim();
    const variety = (row.variety || "").trim();

    assertOwnFlowerType(farm, flowerType);
    if (!(catalog[flowerType] ?? []).includes(variety)) {
      throw new Error(`Сорт «${variety}» не найден в справочнике`);
    }

    return {
      period,
      flowerType,
      variety,
      targetStems: cleanStems(row.targetStems, variety),
    };
  });

  const result = await saveHarvestForecast(cleaned, email);

  revalidatePath("/forecast");
  revalidatePath("/plans/balance");
  return result;
}

/** Ростовка: градация × неделя, на весь цветок. */
export async function saveMixAction(period: string, rows: HarvestMixInput[]) {
  const { email, farm } = await requireAgronomist();
  if (!isValidWeekCode(period)) throw new Error("Неверная неделя");

  const cleaned: HarvestMixInput[] = rows.map((row) => {
    const flowerType = (row.flowerType || "").trim();
    const grade = (row.grade || "").trim();

    assertOwnFlowerType(farm, flowerType);
    if (!getGradesFor(flowerType).includes(grade)) {
      throw new Error(`Недопустимая длина/категория: «${grade}»`);
    }

    return {
      period,
      flowerType,
      grade,
      targetStems: cleanStems(row.targetStems, grade),
    };
  });

  const result = await saveHarvestMix(cleaned, email);

  revalidatePath("/forecast");
  revalidatePath("/plans/balance");
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
    return {
      varieties: [],
      mix: [],
      validCount: 0,
      errorCount: 0,
      fatalError: "Файл не получен",
    };
  }

  const month = String(formData.get("month") ?? "");
  if (!isValidPeriod(month)) {
    return {
      varieties: [],
      mix: [],
      validCount: 0,
      errorCount: 0,
      fatalError: "Не понял, за какой месяц файл",
    };
  }

  const catalog = await listVarietiesByType();
  const buffer = await (file as File).arrayBuffer();
  return parseForecastWorkbook(buffer, catalog, flowerTypesForFarm(farm), month);
}

/**
 * Записывает разобранные строки файла. Неделю каждая строка несёт сама (в файле
 * весь месяц), поэтому пишем по неделям, группируя вызовы.
 */
export async function importForecastAction(
  varieties: ParsedVarietyRow[],
  mix: ParsedMixRow[]
) {
  const goodVarieties = varieties.filter((r) => !r.error && r.variety && r.week);
  const goodMix = mix.filter((r) => !r.error && r.grade && r.week);

  let updated = 0;
  let created = 0;
  let totalStems = 0;

  const varietyByWeek = new Map<string, ParsedVarietyRow[]>();
  for (const row of goodVarieties) {
    const list = varietyByWeek.get(row.week) ?? [];
    list.push(row);
    varietyByWeek.set(row.week, list);
  }
  for (const [week, items] of varietyByWeek) {
    const result = await saveForecastAction(
      week,
      items.map((r) => ({
        period: week,
        flowerType: r.flowerType,
        variety: r.variety,
        targetStems: r.stems,
      }))
    );
    updated += result.updated;
    created += result.created;
    totalStems += items.reduce((s, r) => s + r.stems, 0);
  }

  const mixByWeek = new Map<string, ParsedMixRow[]>();
  for (const row of goodMix) {
    const list = mixByWeek.get(row.week) ?? [];
    list.push(row);
    mixByWeek.set(row.week, list);
  }
  for (const [week, items] of mixByWeek) {
    const result = await saveMixAction(
      week,
      items.map((r) => ({
        period: week,
        flowerType: r.flowerType,
        grade: r.grade,
        targetStems: r.stems,
      }))
    );
    updated += result.updated;
    created += result.created;
  }

  return { updated, created, totalStems };
}
