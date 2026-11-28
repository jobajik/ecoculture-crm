import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

/**
 * Какие сорта у нас есть на самом деле: остаток по сортам (все склады), сколько принято за 60 дней и что сказано о сорте
 * в подписях к живым фото бота (там описан цвет). Ничего не меняет. Нужен, когда про сорта спрашивают «какие и какого
 * цвета» (28.11.2026 — рисунки цветов по сортам).
 *
 *   npx tsx scripts/diag-varieties.ts
 */
import { listBatches } from "../src/lib/repo/batches";
import { listBotPhotos } from "../src/lib/repo/botPhotos";

async function main() {
  const [batches, photos] = await Promise.all([listBatches(), listBotPhotos(true)]);
  const since = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10);
  const map = new Map<string, { left: number; in60: number; last: string }>();
  for (const b of batches) {
    const key = `${b.flowerType}|${b.variety}`;
    const row = map.get(key) ?? { left: 0, in60: 0, last: "" };
    row.left += b.quantityRemaining;
    const day = (b.harvestDate || b.receivedAt || "").slice(0, 10);
    if (day >= since) row.in60 += b.quantityIn;
    if (day > row.last) row.last = day;
    map.set(key, row);
  }
  const rows = Array.from(map.entries()).filter(([, r]) => r.left > 0 || r.in60 > 0).sort((a, b) => a[0].localeCompare(b[0]));
  console.log(`сортов с остатком или приёмкой за 60 дней: ${rows.length}`);
  for (const [key, r] of rows) console.log(`${key} · остаток ${Math.round(r.left)} · принято за 60 дн. ${Math.round(r.in60)} · последняя срезка ${r.last || "-"}`);
  console.log("\nподписи к фото:");
  for (const p of photos) {
    if (!p.active) continue;
    console.log(`${p.flowerType}|${p.variety}|${p.grade} · ${(p as { kind?: string }).kind || "живое"} · «${p.caption.replace(/\s+/g, " ").slice(0, 260)}»`);
  }
}

main().catch((e) => {
  console.error("Не получилось:", e instanceof Error ? e.message : e);
  process.exit(1);
});
