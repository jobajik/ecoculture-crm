/*
 * Списание ушло не с той градации (19.10.2026, Разия: «эустома Corelli Pink 50 см — 2440 шт, ввела как Стандарт,
 * перепутала Стандарт и 50 см»). Без --yes — только показ: списания этой позиции за N дней и остатки обеих
 * градаций. С --yes и номерами списаний: копия таблицы, стебли возвращаются в партии исходной градации, те строки
 * журнала удаляются, а то же количество списывается с партий нужной градации от старых срезок к свежим — новые
 * строки журнала с тем же днём, причиной и автором. Всё одним атомарным запросом; не хватает остатка — ничего.
 *
 * Запуск: npx tsx scripts/writeoff-regrade.ts <json> [--yes]
 *   json: {"flowerType":"eustoma","variety":"Corelli Pink","from":"Стандарт","to":"50","days":3,"ids":["WO-…"]}
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { readFileSync } from "fs";
import { commitAtomic, readTable, rowToRecord, SHEET_TABS, type WriteOp } from "../src/lib/sheets";
import { toBatch } from "../src/lib/repo/batches";
import { toIsoDateTime } from "../src/lib/sheetDate";
import { generateId } from "../src/lib/id";
import { createBackup } from "../src/lib/backup";

const norm = (s: string) => (s || "").trim().toLowerCase().replace(/\s+/g, " ");

async function main() {
  const file = process.argv[2];
  const yes = process.argv.includes("--yes");
  if (!file) throw new Error("нужен файл json");
  const cfg = JSON.parse(readFileSync(file, "utf8").replace(/^﻿/, "")) as {
    flowerType: string;
    variety: string;
    from: string;
    to: string;
    days?: number;
    ids?: string[];
  };
  const since = new Date(Date.now() - (cfg.days ?? 3) * 86400000).toISOString();
  const [bt, wt] = await Promise.all([readTable(SHEET_TABS.BATCHES, { fresh: true }), readTable(SHEET_TABS.WRITEOFFS, { fresh: true })]);
  const batches = bt.rows.map((row, i) => ({ b: toBatch(rowToRecord(SHEET_TABS.BATCHES, row)), rowNumber: bt.rowNumbers[i] }));
  const sameVariety = (x: { flowerType: string; variety: string }) => x.flowerType === cfg.flowerType && norm(x.variety) === norm(cfg.variety);
  const isFrom = (x: { grade: string }) => norm(x.grade) === norm(cfg.from);
  const isTo = (x: { grade: string }) => norm(x.grade) === norm(cfg.to);
  const byId = new Map(batches.map((x) => [x.b.batchId, x]));

  const writeoffs = wt.rows
    .map((row, i) => {
      const r = rowToRecord(SHEET_TABS.WRITEOFFS, row);
      return {
        id: r.WriteoffID,
        createdAt: toIsoDateTime(r.CreatedAt) || r.CreatedAt,
        rawCreatedAt: r.CreatedAt,
        batchId: r.BatchID,
        qty: Number(r.Quantity) || 0,
        reason: r.Reason || "",
        email: r.WarehouseEmail || "",
        rowNumber: wt.rowNumbers[i],
      };
    })
    .filter((w) => {
      const b = byId.get(w.batchId)?.b;
      return !!b && sameVariety(b) && w.createdAt >= since;
    });

  console.log(`=== Списания ${cfg.variety} за ${cfg.days ?? 3} дн. ===`);
  for (const w of writeoffs) {
    const b = byId.get(w.batchId)!.b;
    console.log(`${w.id} · ${w.createdAt.slice(0, 16)} · партия ${w.batchId} (срезка ${b.harvestDate}, ${b.grade}) · ${w.qty} шт · «${w.reason}» · ${w.email}`);
  }
  for (const [label, test] of [[cfg.from, isFrom], [cfg.to, isTo]] as const) {
    const list = batches.filter((x) => sameVariety(x.b) && test(x.b) && !x.b.store);
    console.log(`\n=== Партии «${label}» (основной склад): остаток ${list.reduce((s, x) => s + x.b.quantityRemaining, 0)} ===`);
    for (const x of list.filter((x) => x.b.quantityRemaining > 0 || x.b.harvestDate >= since.slice(0, 10)))
      console.log(`${x.b.batchId} · срезка ${x.b.harvestDate} · приход ${x.b.quantityIn} · остаток ${x.b.quantityRemaining}`);
  }

  if (!yes) return;
  const ids = new Set(cfg.ids ?? []);
  const chosen = writeoffs.filter((w) => ids.has(w.id));
  if (chosen.length !== ids.size || chosen.length === 0) throw new Error("Не все номера списаний найдены — ничего не меняю.");
  if (chosen.some((w) => !isFrom(byId.get(w.batchId)!.b))) throw new Error(`Не все выбранные списания с градации «${cfg.from}» — ничего не меняю.`);
  const total = chosen.reduce((s, w) => s + w.qty, 0);

  // Раскладка на нужную градацию: от старых срезок к свежим.
  const targets = batches
    .filter((x) => sameVariety(x.b) && isTo(x.b) && !x.b.store && x.b.quantityRemaining > 0)
    .sort((a, b) => (a.b.harvestDate || "9999").localeCompare(b.b.harvestDate || "9999") || a.b.batchId.localeCompare(b.b.batchId));
  const have = targets.reduce((s, x) => s + x.b.quantityRemaining, 0);
  if (have < total) throw new Error(`На складе «${cfg.to}» только ${have} шт., а переносим ${total} — ничего не меняю.`);
  let left = total;
  const parts: { x: (typeof targets)[number]; qty: number }[] = [];
  for (const x of targets) {
    if (left <= 0) break;
    const qty = Math.min(left, x.b.quantityRemaining);
    parts.push({ x, qty });
    left -= qty;
  }

  const backup = await createBackup();
  console.log(`\nКопия таблицы: ${backup.url}`);
  const back = new Map<string, number>();
  for (const w of chosen) back.set(w.batchId, (back.get(w.batchId) ?? 0) + w.qty);
  const first = chosen[0];
  const reason = `${first.reason} · исправлено: «${cfg.to}» вместо «${cfg.from}»`.slice(0, 250);
  const ops: WriteOp[] = [
    ...Array.from(back.entries()).map(([batchId, qty]): WriteOp => {
      const x = byId.get(batchId)!;
      return { kind: "update", tab: SHEET_TABS.BATCHES, rowNumber: x.rowNumber, changes: { QuantityRemaining: x.b.quantityRemaining + qty } };
    }),
    ...parts.map((p): WriteOp => ({ kind: "update", tab: SHEET_TABS.BATCHES, rowNumber: p.x.rowNumber, changes: { QuantityRemaining: p.x.b.quantityRemaining - p.qty } })),
    {
      kind: "append",
      tab: SHEET_TABS.WRITEOFFS,
      records: parts.map((p) => ({ WriteoffID: generateId("WO"), CreatedAt: first.rawCreatedAt, BatchID: p.x.b.batchId, Quantity: p.qty, Reason: reason, WarehouseEmail: first.email })),
    },
    { kind: "delete", tab: SHEET_TABS.WRITEOFFS, rowNumbers: chosen.map((w) => w.rowNumber) },
  ];
  await commitAtomic(ops);
  console.log(`Готово: ${total} шт. вернулись в «${cfg.from}» (${back.size} парт.), списаны с «${cfg.to}»:`);
  for (const p of parts) console.log(`  ${p.x.b.batchId} · срезка ${p.x.b.harvestDate} · −${p.qty} (было ${p.x.b.quantityRemaining})`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
