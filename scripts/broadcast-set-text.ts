import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

/**
 * Поменять текст рассылки, которая уже идёт: оставшимся получателям уйдёт новый текст (шаг отправки
 * читает текст рассылки перед каждым сообщением). Метки цен `{цены …}` подставляются сейчас, как при
 * создании. Показывает старый и новый текст, сколько ещё в очереди, и для справки — остаток и цены
 * сорта из `variety` (если указан). Без --yes — показ. Русские слова — в JSON:
 *   { "idFile": "…\\broadcast-current.txt", "text": "Здравствуйте, {имя}! …", "flowerType": "chrysanthemum", "variety": "Altaj" }
 *
 *   npx tsx scripts/broadcast-set-text.ts <json> [--yes]
 *
 * 08.10.2026, владелец про рассылку Altaj: «текст какой-то тяжёлый, потому и не смотрят».
 */
import { readFileSync } from "node:fs";
import { commitAtomic } from "../src/lib/sheets";
import { broadcastUpdate, findBroadcastRow, listRecipients } from "../src/lib/repo/broadcasts";
import { broadcastTextRefusal, personalize } from "../src/lib/broadcast";
import { withPrices } from "../src/lib/broadcastSend";
import { listBatches } from "../src/lib/repo/batches";
import { compareGrades } from "../src/lib/constants";

async function main() {
  const spec = JSON.parse(readFileSync(process.argv[2], "utf8").replace(/^﻿/, "")) as {
    id?: string;
    idFile?: string;
    text: string;
    flowerType?: string;
    variety?: string;
  };
  const apply = process.argv.includes("--yes");
  const id = (spec.idFile ? readFileSync(spec.idFile, "utf8").trim() : "") || spec.id || "";
  const found = await findBroadcastRow(id, true);
  if (!found) throw new Error(`Рассылка «${id}» не найдена`);
  const b = found.broadcast;
  const rec = (await listRecipients(true)).filter((r) => r.broadcastId === id);
  const count = (s: string) => rec.filter((r) => r.status === s).length;
  console.log(`${id} · ${b.title} · ${b.status} · отправлено ${count("sent")}, в очереди ${count("queued")}, ошибок ${count("error")}`);

  if (spec.variety) {
    const left = new Map<string, { main: number; office: number }>();
    for (const x of await listBatches()) {
      if (x.flowerType !== (spec.flowerType || x.flowerType) || x.variety !== spec.variety || x.quantityRemaining <= 0) continue;
      const v = left.get(x.grade) ?? { main: 0, office: 0 };
      if (x.store === "office") v.office += x.quantityRemaining;
      else v.main += x.quantityRemaining;
      left.set(x.grade, v);
    }
    console.log(`\nОстаток ${spec.variety} (основной / офис):`);
    for (const g of [...left.keys()].sort((a, c) => compareGrades(spec.flowerType || "", a, c))) console.log(`  ${g}: ${left.get(g)!.main} / ${left.get(g)!.office}`);
    if (spec.flowerType) {
      const word = { chrysanthemum: "хризантема", rose: "роза", eustoma: "эустома" }[spec.flowerType] || spec.flowerType;
      console.log(`Цены по прайсу:\n${await withPrices(`{цены ${word} ${spec.variety}}`)}`);
    }
  }

  const text = (await withPrices(spec.text.replace(/\r/g, "").trim())).trim();
  const refusal = broadcastTextRefusal(text, Boolean(b.fileId));
  if (refusal) throw new Error(refusal);
  console.log(`\n---БЫЛО---\n${b.text}\n---СТАНЕТ (${text.length} знаков)---\n${text}\n---ТАК УВИДИТ «Айгуль»---\n${personalize(text, "Айгуль", false)}\n---`);
  if (b.text.trim() === text) return console.log("Текст уже такой — менять нечего.");
  if (!apply) return console.log("Только показ. Записать: --yes");
  await commitAtomic([broadcastUpdate(found.rowNumber, { Text: text })]);
  console.log(`Записано: следующие ${count("queued")} получат новый текст.`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
