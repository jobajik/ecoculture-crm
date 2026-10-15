import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

/**
 * Поменять картинку идущей рассылки: `@rotation` — живое фото из ротации (каждому своё, цветок — по тексту
 * рассылки, инфографика не идёт), `@catalog` — каталог, `none` — без картинки. Без --yes — только показ.
 * 14.10.2026: рассылка про хризантему 4 категории шла с инфографикой Altaj — владелец: «почему опять эту инфографику?»
 *
 *   npx tsx scripts/broadcast-set-file.ts --id-file <файл> @rotation [--yes]
 */
import { readFileSync } from "node:fs";
import { commitAtomic } from "../src/lib/sheets";
import { broadcastUpdate, findBroadcastRow } from "../src/lib/repo/broadcasts";
import { listBotPhotos } from "../src/lib/repo/botPhotos";
import { CATALOG_FILE, ROTATION_FILE, flowersInText, isInfoPhoto } from "../src/lib/botPhotos";

async function main() {
  const args = process.argv.slice(2);
  const fi = args.indexOf("--id-file");
  const id = (fi >= 0 ? readFileSync(args[fi + 1], "utf8") : args.find((a) => a.startsWith("BC-")) || "").trim();
  const target = args.find((a) => a === ROTATION_FILE || a === CATALOG_FILE || a === "none");
  if (!id || !target) throw new Error("нужны рассылка и @rotation / @catalog / none");
  const found = await findBroadcastRow(id);
  if (!found) throw new Error("рассылка не найдена");
  const b = found.broadcast;
  console.log(`${id} · «${b.title}» · статус ${b.status} · сейчас картинка «${b.fileId || "нет"}» ${b.fileName}`);
  if (target === ROTATION_FILE) {
    const flowers = flowersInText(b.text);
    const live = (await listBotPhotos(true)).filter((p) => p.active && p.fileId && !isInfoPhoto(p) && (!flowers.length || flowers.includes(p.flowerType)));
    console.log(`цветок по тексту: ${flowers.join(", ") || "не понял — любые"}; живых фото в ротации: ${live.length}`);
    for (const p of live.slice(0, 8)) console.log(`  · ${p.flowerType} ${p.variety || ""} ${p.grade || ""} — ${p.caption.slice(0, 50)}`);
    if (live.length === 0) throw new Error("живых фото нет — оставляю как было");
  }
  if (!args.includes("--yes")) return console.log("Только показ. Поменять: --yes");
  await commitAtomic([broadcastUpdate(found.rowNumber, { FileID: target === "none" ? "" : target, FileName: "" })]);
  console.log(`Готово: картинка рассылки — ${target}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
