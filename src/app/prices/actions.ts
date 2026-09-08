"use server";

import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { authOptions } from "@/lib/auth";
import { savePrices, getCurrentPrices, type PriceInput } from "@/lib/repo/prices";
import { ROLES, getGradesFor, FLOWER_TYPE_LABELS } from "@/lib/constants";
import { listVarietiesByType } from "@/lib/repo/varieties";
import { BASE_VARIETY, priceMapForClient } from "@/lib/priceList";
import { parsePriceWorkbook, type ParsedPriceRow, type PriceParseResult } from "@/lib/excel";

/** Прайс ведут РОП и администратор: цена — это решение о деньгах. */
async function requirePricer(): Promise<void> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) throw new Error("Не авторизован");
  const role = session.user.role;
  if (role !== ROLES.SALES_HEAD && role !== ROLES.ADMIN) {
    throw new Error("Недостаточно прав: прайс ведёт руководитель отдела продаж");
  }
}

export async function savePricesAction(rows: PriceInput[]) {
  await requirePricer();

  const catalog = await listVarietiesByType();

  const cleaned: PriceInput[] = rows.map((row) => {
    const flowerType = (row.flowerType || "").trim();
    const variety = (row.variety || "").trim();
    const grade = (row.grade || "").trim();

    if (!getGradesFor(flowerType).includes(grade)) {
      throw new Error(
        `${FLOWER_TYPE_LABELS[flowerType] ?? flowerType}: недопустимая длина «${grade}»`
      );
    }
    // Пустой сорт — это строка «Все сорта», она законна. Непустой обязан быть
    // в справочнике: иначе цена повиснет на сорте, которого нет.
    if (variety !== BASE_VARIETY && !(catalog[flowerType] ?? []).includes(variety)) {
      throw new Error(`Сорт «${variety}» не найден в справочнике`);
    }

    const price = Number(row.price);
    if (!Number.isFinite(price) || price < 0) throw new Error("Цена не может быть отрицательной");
    if (price > 1_000_000) throw new Error("Слишком большая цена");

    return { flowerType, variety, grade, price: Math.round(price * 100) / 100 };
  });

  const result = await savePrices(cleaned);
  revalidatePath("/prices");
  revalidatePath("/orders/new");
  return result;
}

/**
 * Читает загруженный файл прайса и возвращает разобранные строки. Ничего не
 * записывает: сначала РОП смотрит, что распозналось, и видит «было → стало».
 * Молча уехавшая в таблицу неверная цена — худший вид ошибки: о ней узнают из
 * выставленного счёта.
 */
export async function parsePriceFileAction(formData: FormData): Promise<PriceParseResult> {
  await requirePricer();

  const file = formData.get("file");
  if (!file || typeof file === "string") {
    return { rows: [], validCount: 0, errorCount: 0, sameCount: 0, fatalError: "Файл не получен" };
  }

  const [catalog, current] = await Promise.all([listVarietiesByType(), getCurrentPrices()]);
  const buffer = await (file as File).arrayBuffer();
  return parsePriceWorkbook(buffer, catalog, priceMapForClient(current));
}

/**
 * Записывает разобранные строки файла сегодняшним днём. Строки с ошибками
 * отбрасываются здесь же, а не только в интерфейсе: запрос можно послать и в
 * обход страницы.
 */
export async function importPricesAction(rows: ParsedPriceRow[]) {
  const good = rows.filter((r) => !r.error && r.flowerType && r.grade);
  if (good.length === 0) return { updated: 0, created: 0 };
  return savePricesAction(
    good.map((r) => ({
      flowerType: r.flowerType,
      variety: r.variety,
      grade: r.grade,
      price: r.price,
    }))
  );
}
