/*
 * Поднять или опустить прайс разом: все строки цветка (или одной длины) на сумму в тенге. Правила — `src/lib/priceBump.ts`.
 * Без --yes только показывает, что изменится. Пишет сегодняшним днём тем же `savePrices`, что и страница «Прайс-лист»:
 * история цен остаётся, прежняя цена видна в таблице строкой с прошлой датой.
 *
 * Запуск: npx tsx scripts/price-bump.ts <файл.json> [--yes]
 *   файл: { "kind": "" | "retail", "rules": [ { "flowerType": "rose", "delta": 10 }, { "flowerType": "eustoma", "grade": "Стандарт", "delta": 100 } ] }
 *   поставить цену вместо прибавки: { "flowerType": "eustoma", "grade": "50", "set": 250 }
 * После записи клиентского прайса правит ту же цену в текстах рассылок, которые собраны, но ещё не ушли (`repriceText`).
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { readFileSync } from "fs";
import { getCurrentPrices, savePrices } from "../src/lib/repo/prices";
import { PRICE_KIND_LABELS, cleanPriceKind } from "../src/lib/priceList";
import { planPriceBump, repriceText, type BumpRule } from "../src/lib/priceBump";
import { commitAtomic, type WriteOp } from "../src/lib/sheets";
import { broadcastUpdate, listBroadcastRows, listRecipients, recipientUpdate } from "../src/lib/repo/broadcasts";
import { BROADCAST_STATUSES } from "../src/lib/broadcast";
import { FLOWER_TYPE_LABELS, formatGrade } from "../src/lib/constants";
import { localDayKey } from "../src/lib/timezone";

async function main() {
  const file = process.argv[2];
  const yes = process.argv.includes("--yes");
  if (!file) throw new Error("Укажите файл с правилами");
  const input = JSON.parse(readFileSync(file, "utf-8").replace(/^﻿/, "")) as { kind?: string; rules: BumpRule[] };
  const kind = cleanPriceKind(input.kind);
  const today = localDayKey();
  const prices = await getCurrentPrices(today, kind);
  const plan = planPriceBump(prices, input.rules ?? []);
  if (typeof plan === "string") throw new Error(plan);
  console.log(`${PRICE_KIND_LABELS[kind]} · на ${today} · строк к изменению: ${plan.lines.length}`);
  for (const rule of input.rules) {
    const own = plan.lines.filter((l) => l.flowerType === rule.flowerType && (!rule.grade || l.grade === rule.grade));
    console.log(`\n--- ${FLOWER_TYPE_LABELS[rule.flowerType] ?? rule.flowerType}${rule.grade ? ` · ${formatGrade(rule.grade)}` : " · все длины"}: ${rule.set ? `поставить ${rule.set} тг` : `${(rule.delta ?? 0) > 0 ? "+" : ""}${rule.delta} тг`}, строк ${own.length}`);
    for (const l of own) console.log(`  ${(l.variety || "Все сорта").padEnd(24)} ${formatGrade(l.grade).padEnd(14)} ${String(l.before).padStart(7)} -> ${String(l.after).padStart(7)}`);
  }
  if (plan.empty.length > 0) throw new Error(`По правилу не нашлось ни одной цены: ${plan.empty.map((r) => `${r.flowerType}${r.grade ? ` · ${r.grade}` : ""}`).join("; ")} — ничего не записано`);
  // Тексты рассылок, которые собраны, но ещё не ушли: в них стоит прежняя цена (план автопилота собирается в 9:00).
  const names = { flower: (f: string) => FLOWER_TYPE_LABELS[f] ?? f, grade: formatGrade };
  const active = new Set<string>([BROADCAST_STATUSES.DRAFT, BROADCAST_STATUSES.SENDING, BROADCAST_STATUSES.PAUSED]);
  const stale = async () => {
    if (kind) return { writes: [] as WriteOp[], people: 0, broadcasts: 0 };
    const rows = (await listBroadcastRows(true)).filter((r) => active.has(r.broadcast.status));
    const ids = new Set(rows.map((r) => r.broadcast.broadcastId));
    const writes: WriteOp[] = [];
    let people = 0;
    for (const r of (await listRecipients(true)).filter((x) => ids.has(x.broadcastId) && x.status === "queued" && x.text)) {
      const next = repriceText(r.text || "", plan.lines, names);
      if (next !== r.text) {
        writes.push(recipientUpdate(r.rowNumber, { Text: next }));
        people++;
      }
    }
    let broadcasts = 0;
    for (const r of rows) {
      const next = repriceText(r.broadcast.text, plan.lines, names);
      if (next !== r.broadcast.text) {
        writes.push(broadcastUpdate(r.rowNumber, { Text: next }));
        broadcasts++;
      }
    }
    return { writes, people, broadcasts };
  };
  const before = await stale();
  console.log(`\nРассылки, которые ещё не ушли: прежняя цена стоит у ${before.people} получателей и в ${before.broadcasts} общих текстах.`);
  if (!yes) {
    console.log("\nЭто показ. Чтобы записать — добавьте --yes.");
    return;
  }
  const result = await savePrices(plan.lines.map((l) => ({ flowerType: l.flowerType, variety: l.variety, grade: l.grade, price: l.after })), today, kind);
  console.log(`\nЗаписано: новых строк ${result.created}, переписано сегодняшних ${result.updated}.`);
  const after = await getCurrentPrices(today, kind);
  const wrong = plan.lines.filter((l) => (after.get(`${l.flowerType}|${l.variety}|${l.grade}`)?.price ?? 0) !== l.after);
  // Перечитываем очередь заново: пока писали прайс, часть сообщений могла уйти.
  const fix = await stale();
  for (let i = 0; i < fix.writes.length; i += 200) await commitAtomic(fix.writes.slice(i, i + 200));
  console.log(`В неотправленных рассылках цена исправлена: получателей ${fix.people}, общих текстов ${fix.broadcasts}.`);
  console.log(wrong.length === 0 ? "Проверка чтением: все цены на месте." : `ВНИМАНИЕ: не совпало строк ${wrong.length}: ${wrong.slice(0, 5).map((l) => `${l.variety || "Все сорта"} ${l.grade}`).join(", ")}`);
}

main().catch((e) => {
  console.error("ОШИБКА:", e instanceof Error ? e.message : e);
  process.exit(1);
});
