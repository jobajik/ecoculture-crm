"use server";

import { revalidatePath } from "next/cache";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { guard } from "@/lib/actionResult";
import { formatGrade } from "@/lib/constants";
import { isRegionStore, normalizeStore, regionStoreInfo, type StoreCode } from "@/lib/officeStore";
import { canLoadTrucks } from "@/lib/regionTruck";
import { commitTruckLoad } from "@/lib/repo/regionTruck";
import { getOrderById } from "@/lib/repo/orders";
import { restOption, type LoadExtra, type LoadLine } from "@/lib/truckLoad";
import { notifyCityOfTruckLoad } from "@/lib/truckNotify";
import { siteOrigin } from "@/lib/waybillKick";
import { forgetReads } from "@/lib/sheets";
import { localDayKey } from "@/lib/timezone";
import { addDaysToKey } from "@/lib/dayKey";

/**
 * Погрузка фуры в город (22.11.2026, правила — `src/lib/truckLoad.ts`): зав. складом отвечает на заказ города одной
 * записью — что грузит, чего нет, что добавил. Зав. складом — только свой цветок; администратор — любой.
 */
async function loadTruckActionInner(input: { store: string; day: string; lines: LoadLine[]; extras: LoadExtra[]; note?: string }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) throw new Error("Не авторизован");
  const role = session.user.role ?? "";
  if (!canLoadTrucks(role)) throw new Error("Фуры в регионы грузит зав. складом");
  const farm = role === "admin" ? null : session.user.farm ?? null;
  // Пустое производство у зав. складом — это не «все цветы» (грабли 1.10).
  if (role !== "admin" && !farm) throw new Error("У вас не указано производство — попросите администратора заполнить его в «Настройках»");
  const store = normalizeStore(input.store) as StoreCode;
  const info = regionStoreInfo(store);
  if (!isRegionStore(store) || !info) throw new Error("Город не из списка регионов");
  const day = String(input.day || "");
  const today = localDayKey();
  // День фуры без заказа города — сегодня или рядом: «отгрузил в город» задним числом на месяц — это уже правка базы.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day < addDaysToKey(today, -14) || day > addDaysToKey(today, 30)) throw new Error("Проверьте день фуры");

  const lines: LoadLine[] = (input.lines ?? []).map((l) => ({ itemId: String(l.itemId || ""), load: Number(l.load) || 0, rest: String(l.rest || "") }));
  const extras: LoadExtra[] = (input.extras ?? []).map((e) => ({
    flowerType: String(e.flowerType || ""),
    variety: String(e.variety || ""),
    grade: String(e.grade || ""),
    quantity: Number(e.quantity) || 0,
    note: String(e.note ?? ""),
  }));

  // Что закрывается без отгрузки — для сообщения менеджеру города (до записи: после неё количество в заявке уже факт).
  const closing = lines.filter((l) => restOption(l.rest)?.closes);
  const result = await commitTruckLoad({ store, day, lines, extras, farm, byEmail: session.user.email.toLowerCase(), note: input.note });

  revalidatePath("/warehouse");
  revalidatePath("/warehouse/trucks");
  revalidatePath("/warehouse/batches");
  revalidatePath("/warehouse/stock");
  revalidatePath("/region", "layout");
  revalidatePath("/orders");
  revalidatePath("/retail");
  revalidatePath("/plans/regions");
  revalidatePath("/");

  // Сообщение менеджеру города — после записи и только если что-то уехало или чего-то не будет. Не ушло — не беда.
  try {
    forgetReads();
    const missing: { name: string; quantity: number; note: string }[] = [];
    if (closing.length > 0) {
      const orders = await Promise.all(result.orderIds.map((id) => getOrderById(id)));
      for (const o of orders) {
        for (const i of o?.items ?? []) {
          if (!closing.some((l) => l.itemId === i.itemId)) continue;
          const short = (i.askedQuantity ?? i.quantity) - i.quantity;
          if (short > 0) missing.push({ name: `${i.variety} ${formatGrade(i.grade)}`, quantity: short, note: i.stockNote || "нет на складе" });
        }
      }
    }
    if (result.total > 0 || missing.length > 0) {
      await notifyCityOfTruckLoad({ store, city: info.label, day, total: result.total, missing, added: result.added, origin: siteOrigin() });
    }
  } catch (err) {
    console.error("truck load notify:", err instanceof Error ? err.message : err);
  }
  return { total: result.total, closedShort: result.closedShort, added: result.added, city: info.label, refused: result.refused.length };
}

export async function loadTruckAction(...args: Parameters<typeof loadTruckActionInner>) {
  return guard(() => loadTruckActionInner(...args));
}
