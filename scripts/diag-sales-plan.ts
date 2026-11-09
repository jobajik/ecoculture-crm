import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

/**
 * Данные для плана продаж менеджерам по дням (09.11.2026, владелец: «план продаж с учётом стоков, текущей срезки и
 * остатков по датам; 12 ноября отгружаем в Киргизию»). Ничего не меняет — пишет снимок в JSON:
 * склад по партиям (дата среза, срок), неотгруженные заявки, приёмка, продажи и списания по дням за N дней, прогноз
 * агронома и ростовка, цены, менеджеры.
 *
 *   npx tsx scripts/diag-sales-plan.ts <файл.json> [дней истории, 28]
 */
import { writeFileSync } from "node:fs";
import { prefetchTables, SHEET_TABS } from "../src/lib/sheets";
import { listBatches } from "../src/lib/repo/batches";
import { listOrdersWithItems } from "../src/lib/repo/orders";
import { listShipments } from "../src/lib/repo/shipments";
import { listWriteoffs } from "../src/lib/repo/writeoffs";
import { listHarvestForecast } from "../src/lib/repo/harvestForecast";
import { listHarvestMix } from "../src/lib/repo/harvestMix";
import { listUsers } from "../src/lib/repo/users";
import { getSettings } from "../src/lib/repo/settings";
import { getCurrentPrices } from "../src/lib/repo/prices";
import { priceFor } from "../src/lib/priceList";
import { localDayKey } from "../src/lib/timezone";
import { isConsignment, isRegionOrder } from "../src/lib/orderKind";
import { normalizeStore } from "../src/lib/officeStore";
import { ORDER_STATUSES } from "../src/lib/constants";
import { loadIntake } from "../src/lib/repo/greenhouse";

const dayOf = (iso: string) => (iso || "").slice(0, 10);

async function main() {
  const out = process.argv[2];
  const days = Number(process.argv[3] || 28);
  if (!out) throw new Error("Укажите файл JSON");
  const today = localDayKey();
  const from = new Date(Date.parse(`${today}T00:00:00Z`) - days * 86400000).toISOString().slice(0, 10);

  await prefetchTables([SHEET_TABS.ORDERS, SHEET_TABS.ORDER_ITEMS, SHEET_TABS.CLIENTS, SHEET_TABS.BATCHES, SHEET_TABS.SHIPMENTS, SHEET_TABS.WRITEOFFS]);
  const [batches, orders, shipments, writeoffs, forecast, mix, users, settings, prices] = await Promise.all([
    listBatches(),
    listOrdersWithItems(),
    listShipments(),
    listWriteoffs(),
    listHarvestForecast(),
    listHarvestMix(),
    listUsers(),
    getSettings(),
    getCurrentPrices(),
  ]);
  const batchById = new Map(batches.map((b) => [b.batchId, b]));
  const nameOf = new Map(users.map((u) => [u.email, u.name || u.email]));
  const channel = (o: (typeof orders)[number]) =>
    (o.retail || "").trim() ? "shops" : isRegionOrder(o) ? "region" : isConsignment(o) ? "point" : "clients";

  const stock = batches
    .filter((b) => b.quantityRemaining > 0)
    .map((b) => ({
      f: b.flowerType,
      v: b.variety,
      g: b.grade,
      cut: dayOf(b.harvestDate || b.receivedAt),
      recv: dayOf(b.receivedAt),
      q: b.quantityRemaining,
      store: normalizeStore(b.store),
    }));

  const open = orders
    .filter((o) => o.status !== ORDER_STATUSES.CANCELLED)
    .flatMap((o) =>
      o.items
        .filter((i) => i.quantity - i.shippedQuantity > 0)
        .map((i) => ({
          code: o.orderId.split("-").pop(),
          client: o.clientName,
          mgr: nameOf.get(o.managerEmail) ?? o.managerEmail,
          created: dayOf(o.createdAt),
          delivery: dayOf(o.deliveryDate),
          dir: o.direction || "",
          ch: channel(o),
          store: normalizeStore((o as { store?: string }).store || ""),
          status: o.status,
          f: i.flowerType,
          v: i.variety,
          g: i.grade,
          q: i.quantity - i.shippedQuantity,
          price: i.unitPrice,
        }))
    );

  const receipts = batches
    .filter((b) => normalizeStore(b.store) === "" && b.quantityIn > 0 && dayOf(b.harvestDate || b.receivedAt) >= from)
    .map((b) => ({ d: dayOf(b.harvestDate || b.receivedAt), f: b.flowerType, v: b.variety, g: b.grade, q: b.quantityIn }));

  const sales = orders
    .filter((o) => o.status !== ORDER_STATUSES.CANCELLED && dayOf(o.createdAt) >= from)
    .flatMap((o) =>
      o.items.map((i) => ({
        d: dayOf(o.createdAt),
        dd: dayOf(o.deliveryDate),
        ch: channel(o),
        dir: o.direction || "",
        mgr: nameOf.get(o.managerEmail) ?? o.managerEmail,
        f: i.flowerType,
        v: i.variety,
        g: i.grade,
        q: i.quantity,
        sum: i.quantity * i.unitPrice,
      }))
    );

  const shipped = shipments
    .filter((s) => dayOf(s.createdAt) >= from)
    .map((s) => {
      const b = batchById.get(s.batchId);
      return { d: dayOf(s.createdAt), f: b?.flowerType ?? "", g: b?.grade ?? "", v: b?.variety ?? "", q: s.quantity, store: normalizeStore(b?.store ?? "") };
    });

  const wo = writeoffs
    .filter((w) => dayOf(w.createdAt) >= from)
    .map((w) => {
      const b = batchById.get(w.batchId);
      return { d: dayOf(w.createdAt), f: b?.flowerType ?? "", g: b?.grade ?? "", v: b?.variety ?? "", q: w.quantity, reason: w.reason, cut: dayOf(b?.harvestDate ?? "") };
    });

  const keys = new Set(stock.map((s) => `${s.f}|${s.v}|${s.g}`).concat(open.map((o) => `${o.f}|${o.v}|${o.g}`)));
  const price: Record<string, number> = {};
  for (const k of keys) {
    const [f, v, g] = k.split("|");
    price[k] = priceFor(prices, f, v, g);
  }

  // Приёмка теплицы Rose Farm (характеристики): хризантема Rose Farm считается здесь с 03.11 — даже если на склад она
  // ещё не принималась отдельным товаром.
  const intake = (await loadIntake("rose_farm").catch(() => []))
    .filter((r) => r.kind === "accept" && r.date >= from)
    .map((r) => ({ d: r.date, f: r.flower === "chrysanthemum" ? "chrysanthemum_rf" : r.flower, v: r.variety, g: r.grade, q: r.qty }));

  const months = [today.slice(0, 7), new Date(Date.parse(`${today}T00:00:00Z`) + 20 * 86400000).toISOString().slice(0, 7)];
  const data = {
    today,
    from,
    shelfLife: settings.shelfLifeDays,
    warning: settings.warningThreshold,
    stock,
    open,
    receipts,
    intake,
    sales,
    shipped,
    writeoffs: wo,
    forecast: forecast.filter((r) => months.some((m) => r.period.startsWith(m))),
    mix: mix.filter((r) => months.some((m) => r.period.startsWith(m))),
    price,
    managers: users.filter((u) => u.active && ["manager", "sales_head"].includes(u.role)).map((u) => ({ name: u.name, email: u.email, role: u.role })),
  };
  writeFileSync(out, JSON.stringify(data));
  console.log(
    `Готово: ${out} · склад ${stock.length} партий (${stock.reduce((s, x) => s + x.q, 0)} шт.), неотгружено ${open.length} поз., приёмка ${receipts.length}, продажи ${sales.length}, отгрузки ${shipped.length}, списания ${wo.length}, прогноз ${data.forecast.length}, приёмка теплицы RF ${intake.length}`
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
