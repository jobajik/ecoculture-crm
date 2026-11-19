import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

/**
 * Записать отгрузку задним числом: цветок клиенту уже отдали, а в CRM заявка висит неотгруженной (19.11.2026, зав.
 * складом Есентая: «FR7VT, 2NAUT, FMEZT — эти надо удалить»; все три оплачены через Kaspi, у двух уже реализация в 1С;
 * владелец: «цветок уже отдали»). Удалять такую заявку нельзя — вместе с ней из выручки ушли бы настоящие деньги.
 * Правильно — снять цветок со склада тем же путём, что кнопка «Отгрузить всю заявку»: раскладка по партиям от старых
 * срезок к свежим (`planWholeOrderShipment`), запись одним запросом со всеми проверками (`createOrderShipments`).
 *
 * Отличия от кнопки склада:
 * - склад можно назвать (`store`: "" — основной, "office", "astana" …). Заявка менеджера региона уходила клиенту из
 *   города, а записана на основной склад: тогда склад заявки сначала переставляется на названный (`setOrderStore`),
 *   иначе отгрузка отказала бы «партия лежит не на том складе»;
 * - накладная клиенту по такой отгрузке НЕ отправляется: в `Waybills` сразу пишется строка «не отправлялась» на эти
 *   строки журнала, и автомат их не возьмёт. Накладная на позавчерашний заказ выглядела бы ошибкой;
 * - строка в журнале денег (`warehouse_adjusted`) — кто, когда и почему, словами.
 *
 * Без --yes — только показ (склад заявки, раскладка, нехватка). С --yes — сначала копия таблицы.
 *
 *   npx tsx scripts/ship-after-fact.ts <json> [--yes]
 *   json: [{ "code": "FR7VT", "store": "astana", "note": "почему" }]   («store» не указан — склад заявки)
 */
import { readFileSync } from "node:fs";
import { getOrderById, listOrdersWithItems, setOrderStore } from "../src/lib/repo/orders";
import { listBatches } from "../src/lib/repo/batches";
import { listShipments, createOrderShipments } from "../src/lib/repo/shipments";
import { listClients } from "../src/lib/repo/clients";
import { listUsers } from "../src/lib/repo/users";
import { createWaybill, listWaybillsStrict } from "../src/lib/repo/waybills";
import { logMoney } from "../src/lib/repo/moneyLog";
import { createBackup } from "../src/lib/backup";
import { planWholeOrderShipment } from "../src/lib/shipRules";
import { inStore, normalizeStore, storeLabel, type StoreCode } from "../src/lib/officeStore";
import { orderCode } from "../src/lib/paymentStage";
import { localDayKey } from "../src/lib/timezone";
import { MONEY_LOG_ACTIONS, ORDER_STATUSES } from "../src/lib/constants";
import { forgetReads } from "../src/lib/sheets";
import { buildWaybillDoc, nextWaybillNumber } from "../src/lib/waybill";

const OWNER = "y.sadakbayev@gmail.com";
const n = (v: number) => Math.round(v).toLocaleString("ru-RU");
const where = (s: string) => (normalizeStore(s) === "" ? "основной склад" : storeLabel(s));

interface Job {
  code: string;
  store?: string;
  note?: string;
}

async function main() {
  const file = process.argv.slice(2).find((a) => !a.startsWith("--"));
  const yes = process.argv.includes("--yes");
  if (!file) throw new Error("Укажите файл JSON");
  const jobs = JSON.parse(readFileSync(file, "utf8").replace(/^﻿/, "")) as Job[];

  if (yes) {
    const backup = await createBackup(new Date(), (m) => console.log(`  копия: ${m}`));
    console.log(`Копия таблицы: ${backup.url}`);
  }
  for (const job of jobs) {
    forgetReads();
    const code = job.code.trim().toUpperCase();
    const found = (await listOrdersWithItems()).find((o) => orderCode(o.orderId) === code);
    if (!found) {
      console.log(`\n${code}: не найдена`);
      continue;
    }
    const store = job.store === undefined ? normalizeStore(found.store) : normalizeStore(job.store);
    const batches = await listBatches();
    console.log(`\n${code} · ${found.clientName} · ${found.status} · склад заявки: ${where(found.store)} · отгружать: ${where(store)} · сумма ${n(found.totalAmount)} ₸, оплачено ${n(found.paidAmount)} ₸`);
    if (found.status === ORDER_STATUSES.CANCELLED) {
      console.log("  отменена — не трогаю");
      continue;
    }
    // Что есть на каждом складе по позициям заявки — чтобы выбрать склад до записи.
    for (const s of ["", "office", "astana", "karaganda", "semey", "ust_kamenogorsk"] as StoreCode[]) {
      const p = planWholeOrderShipment(found.items, inStore(batches, s));
      if (p.total > 0 || s === store) console.log(`  ${s === store ? "→" : " "} ${where(s)}: можно ${p.total} шт.${p.shortages.length ? `, не хватает ${p.shortages.reduce((a, x) => a + x.missing, 0)}` : ""}`);
    }
    const plan = planWholeOrderShipment(found.items, inStore(batches, store));
    for (const l of plan.lines) {
      const item = found.items.find((i) => i.itemId === l.itemId)!;
      console.log(`  ${item.variety} ${item.grade}: ${l.parts.reduce((s, p) => s + p.quantity, 0)} шт. — ${l.parts.map((p) => `${p.batchId} ${p.quantity}`).join(", ")}`);
    }
    for (const s of plan.shortages) {
      const item = found.items.find((i) => i.itemId === s.itemId)!;
      console.log(`  НЕ ХВАТАЕТ ${item.variety} ${item.grade}: ${s.missing} шт. — отгрузка не записана`);
    }
    if (plan.total === 0) {
      console.log("  отгружать нечего");
      continue;
    }
    // Недостача — не пишем ничего: «отдали целиком» с половиной отгрузки было бы враньём в остатках.
    if (!yes || plan.shortages.length > 0) continue;

    if (store !== normalizeStore(found.store)) {
      await setOrderStore(found.orderId, store);
      console.log(`  склад заявки: ${where(found.store)} → ${where(store)}`);
    }
    const ids = await createOrderShipments({ orderId: found.orderId, warehouseEmail: OWNER, lines: plan.lines });
    console.log(`  → снято со склада ${plan.total} шт. (${ids.length} строк журнала)`);

    // Накладная клиенту по отгрузке задним числом не уходит: строка «не отправлялась» занимает эти строки журнала.
    forgetReads();
    const [order, shipments, waybills, clients, users] = await Promise.all([getOrderById(found.orderId), listShipments(), listWaybillsStrict(), listClients(), listUsers()]);
    const name = (email: string) => (users.find((u) => u.email.toLowerCase() === email.toLowerCase())?.name || "").split(/\s+/)[0] || "";
    const own = shipments.filter((s) => s.orderId === found.orderId);
    const doc = buildWaybillDoc({
      order: order!,
      shipments: own,
      shipmentIds: ids,
      number: nextWaybillNumber(found.orderId, waybills.filter((w) => w.orderId === found.orderId)),
      date: localDayKey(),
      city: clients.find((c) => c.clientId === found.clientId)?.city || "",
      manager: name(found.managerEmail || ""),
      shippedBy: "",
    });
    await createWaybill({ orderId: found.orderId, shipmentIds: ids, doc, phone: "", status: "skipped", note: "отгрузка записана задним числом — клиенту не отправлялась", byEmail: OWNER });

    await logMoney({
      actorEmail: OWNER,
      orderId: found.orderId,
      action: MONEY_LOG_ACTIONS.WAREHOUSE_ADJUSTED,
      details: `Отгрузка записана задним числом (цветок клиенту уже отдали): ${found.clientName}, ${plan.total} шт. с «${where(store)}»${job.note ? `. ${job.note}` : ""}`.slice(0, 900),
      amountBefore: found.paidAmount,
      amountAfter: found.paidAmount,
    });
  }
  if (!yes) console.log("\nТолько показ. Записать: --yes");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
