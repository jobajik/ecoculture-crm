import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

/**
 * Пометить фото бота инфографикой (клиенту один раз, для знакомства с сортом) или живым фото.
 * То же делает кнопка на странице «Фото и каталог». Без --yes — только показ.
 *
 *   npx tsx scripts/bot-photo-kind.ts <PhotoID | часть имени файла> <info|live> [--yes]
 */
import { commitAtomic } from "../src/lib/sheets";
import { botPhotoUpdate, listBotPhotos } from "../src/lib/repo/botPhotos";
import { photoLabel } from "../src/lib/botPhotos";

async function main() {
  const [key, kind] = process.argv.slice(2);
  if (!key || (kind !== "info" && kind !== "live")) throw new Error("нужно: <PhotoID или часть имени файла> <info|live>");
  const found = (await listBotPhotos(true)).filter((p) => p.photoId === key || p.fileName.toLowerCase().includes(key.toLowerCase()));
  if (found.length !== 1) throw new Error(`нашлось фото: ${found.length} — уточните`);
  const p = found[0];
  console.log(`${p.photoId} · ${photoLabel(p)} · ${p.fileName} · сейчас: ${p.kind === "info" ? "инфографика" : "живое"} → станет: ${kind === "info" ? "инфографика" : "живое"}`);
  if (!process.argv.includes("--yes")) return console.log("Только показ. Записать: --yes");
  await commitAtomic([botPhotoUpdate(p.rowNumber, { Kind: kind === "info" ? "info" : "" })]);
  console.log("Записано.");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
