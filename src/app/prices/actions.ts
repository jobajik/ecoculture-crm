"use server";

import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { authOptions } from "@/lib/auth";
import { savePrices, type PriceInput } from "@/lib/repo/prices";
import { ROLES, getGradesFor, FLOWER_TYPE_LABELS } from "@/lib/constants";
import { listVarietiesByType } from "@/lib/repo/varieties";
import { BASE_VARIETY } from "@/lib/priceList";

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
