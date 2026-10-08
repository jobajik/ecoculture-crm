/**
 * Исправление ошибочной приёмки (`src/lib/batchFix.ts`): кто может, какую партию, что пишется.
 *   npx tsx scripts/check-batch-fix.ts
 */
import { batchFixRefusal, batchTouches, likelyDuplicates, planBatchEdit, type BatchJournals } from "../src/lib/batchFix";
import type { Batch } from "../src/lib/types";

let failed = 0;
function check(name: string, ok: boolean) {
  console.log(`${ok ? "✓" : "✗"} ${name}`);
  if (!ok) failed++;
}
function throws(fn: () => unknown, part: string): boolean {
  try {
    fn();
    return false;
  } catch (e) {
    return e instanceof Error && e.message.includes(part);
  }
}

const b = (over: Partial<Batch> = {}): Batch => ({
  batchId: "B1",
  receivedAt: "2026-10-08T10:00:00Z",
  harvestDate: "2026-10-05",
  flowerType: "eustoma",
  variety: "Celeb 2 Gold",
  grade: "50",
  quantityIn: 70,
  quantityRemaining: 70,
  location: "",
  receivedByEmail: "razia@x",
  store: "",
  sourceBatchId: "",
  ...over,
});
const empty: BatchJournals = { shipments: [], writeoffs: [], takeouts: [], moves: [], batches: [] };

// --- нетронутая или нет
check("нетронутая: журналов нет", batchTouches(b(), empty).length === 0);
check("отгрузка трогает", batchTouches(b(), { ...empty, shipments: [{ batchId: "B1" }] })[0].startsWith("отгрузки"));
check("списание трогает", batchTouches(b(), { ...empty, writeoffs: [{ batchId: "B1" }] }).length === 1);
check("выдача трогает", batchTouches(b(), { ...empty, takeouts: [{ batchId: "B1" }] }).length === 1);
check("перемещение трогает", batchTouches(b(), { ...empty, moves: [{ fromBatchId: "B1", toBatchId: "B9" }] }).length === 1);
check("офисная партия от неё трогает", batchTouches(b(), { ...empty, batches: [{ batchId: "B9", sourceBatchId: "B1" }] }).length === 1);
check("остаток меньше прихода без журнала — тронута", batchTouches(b({ quantityRemaining: 60 }), empty).length === 1);
check("чужая партия в журнале не трогает", batchTouches(b(), { ...empty, shipments: [{ batchId: "B2" }] }).length === 0);

// --- кто может
const ok = (role: string, farm: string | null, batch = b(), touches: string[] = []) =>
  batchFixRefusal({ role, farm, batch, touches });
check("зав. складом Rose Farm — эустому можно", ok("warehouse", "rose_farm") === "");
check("зав. складом Есентая — эустому нельзя", ok("warehouse", "esentai") !== "");
check("зав. складом без производства — нельзя", ok("warehouse", null) !== "");
check("админ — можно", ok("admin", null) === "");
check("менеджер — нельзя", ok("manager", null) !== "");
check("склад офиса — нельзя", ok("office", null) !== "");
check("офисная партия — нельзя", ok("admin", null, b({ store: "office" })) !== "");
check("тронутая — нельзя, с объяснением", ok("admin", null, b(), ["отгрузки: 1"]).includes("отгрузки: 1"));

// --- правка
const ctx = { varieties: ["Celeb 2 Gold", "Arena I Pure White", "Мини-микс"], today: "2026-10-08" };
const base = { variety: "Celeb 2 Gold", grade: "50", quantity: 70, harvestDate: "2026-10-05" };
check("ничего не изменилось — отказ", throws(() => planBatchEdit(b(), base, ctx), "Ничего"));
const q = planBatchEdit(b(), { ...base, quantity: 60 }, ctx);
check("количество пишется в приход и остаток", q.changes.QuantityIn === 60 && q.changes.QuantityRemaining === 60);
check("в описании было → стало", q.summary.includes("70 → 60"));
const v = planBatchEdit(b(), { ...base, variety: "arena i pure white" }, ctx);
check("сорт — как в справочнике", v.changes.Variety === "Arena I Pure White" && !("QuantityIn" in v.changes));
check("сорта нет в справочнике — отказ", throws(() => planBatchEdit(b(), { ...base, variety: "Выдумка" }, ctx), "нет в справочнике"));
check("чужая градация — отказ", throws(() => planBatchEdit(b(), { ...base, grade: "70" }, ctx), "градация"));
check("ноль — отказ", throws(() => planBatchEdit(b(), { ...base, quantity: 0 }, ctx), "больше нуля"));
check("дробь — отказ", throws(() => planBatchEdit(b(), { ...base, quantity: 1.5 }, ctx), "целое"));
check("дата из будущего — отказ", throws(() => planBatchEdit(b(), { ...base, harvestDate: "2026-10-09" }, ctx), "будущем"));
check("дата полгода назад — отказ", throws(() => planBatchEdit(b(), { ...base, harvestDate: "2026-03-01" }, ctx), "не раньше"));
check("дата сегодня — можно", planBatchEdit(b(), { ...base, harvestDate: "2026-10-08" }, ctx).changes.HarvestDate === "2026-10-08");
const mm = planBatchEdit(b(), { ...base, variety: "Мини-микс", grade: "50" }, ctx);
check("сорт «Мини-микс» — градация «Мини-микс» сама", mm.changes.Grade === "Мини-микс");

// --- повтор приёмки
const dups = likelyDuplicates([
  b({ batchId: "A" }),
  b({ batchId: "B" }),
  b({ batchId: "C", quantityIn: 50, quantityRemaining: 50 }),
  b({ batchId: "D", store: "office", quantityIn: 70 }),
]);
check("одинаковые приёмки помечены обе", dups.has("A") && dups.has("B"));
check("другое количество — не повтор", !dups.has("C"));
check("офисная партия — не в счёт", !dups.has("D"));

if (failed) {
  console.log(`\nПровалено: ${failed}`);
  process.exit(1);
}
console.log("\nВсе проверки прошли");
