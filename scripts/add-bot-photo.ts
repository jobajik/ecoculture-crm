import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

/**
 * Добавить готовую картинку в «Клиенты → Рассылки → Фото и каталог» без браузера:
 * файл — во вкладку WaFiles (base64 кусками), строка — в BotPhotos. Дальше она
 * доступна в рассылках («Фото из ротации») и боту (фото позиции по цветку и сорту).
 *
 * Аргументы — JSON-файл в UTF-8 (русские слова в .bat портятся кодировкой консоли):
 *   { "file": "C:\\...\\картинка.jpg", "flowerType": "chrysanthemum", "variety": "Altaj",
 *     "grade": "", "caption": "...", "email": "кто добавил" }
 *
 * Повторный запуск того же файла с тем же сортом ничего не дублирует. Без --yes — показ.
 *
 *   npx tsx scripts/add-bot-photo.ts <json> [--yes]
 *
 * 04.10.2026: инфографика категорий Altaj для рассылок.
 */
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { appendFilePart } from "../src/lib/repo/broadcasts";
import { createBotPhoto, listBotPhotos } from "../src/lib/repo/botPhotos";
import { MAX_PHOTO_CAPTION, photoLabel } from "../src/lib/botPhotos";
import { FLOWER_TYPE_LABELS } from "../src/lib/constants";

interface Input {
  file: string;
  flowerType: string;
  variety?: string;
  grade?: string;
  caption: string;
  email: string;
}

async function main() {
  const argPath = process.argv[2];
  if (!argPath) throw new Error("Укажите JSON-файл с параметрами");
  const input = JSON.parse(readFileSync(argPath, "utf8").replace(/^\uFEFF/, "")) as Input;
  const variety = (input.variety || "").trim();
  const grade = (input.grade || "").trim();
  const caption = (input.caption || "").trim();
  if (!FLOWER_TYPE_LABELS[input.flowerType]) throw new Error(`Незнакомый цветок: ${input.flowerType}`);
  if (!caption || caption.length > MAX_PHOTO_CAPTION) throw new Error(`Подпись пустая или длиннее ${MAX_PHOTO_CAPTION} знаков`);
  if (!input.email) throw new Error("Укажите, кто добавил (email)");

  const data = readFileSync(input.file);
  const isJpeg = data[0] === 0xff && data[1] === 0xd8;
  if (!isJpeg) throw new Error("Нужен JPEG: рисовальщик каталога и рассылки понимают JPEG");
  if (data.length > 2_500_000) throw new Error(`Файл слишком большой: ${data.length} байт`);
  const fileName = basename(input.file);

  const existing = (await listBotPhotos(true)).find(
    (p) => p.fileName === fileName && p.flowerType === input.flowerType && p.variety === variety && p.grade === grade,
  );
  console.log(`Фото: ${photoLabel({ flowerType: input.flowerType, variety, grade })}`);
  console.log(`Файл: ${fileName}, ${Math.round(data.length / 1024)} КБ`);
  console.log(`Подпись (${caption.length} знаков): ${caption}`);
  if (existing) return console.log(`Уже есть: ${existing.photoId} (${existing.active ? "включено" : "выключено"}) — ничего не делаю.`);
  if (!process.argv.includes("--yes")) return console.log("Только показ.");

  const { fileId } = await appendFilePart({
    fileId: "",
    createdByEmail: input.email,
    name: fileName,
    mime: "image/jpeg",
    size: data.length,
    partOffset: 0,
    data: data.toString("base64"),
  });
  const photoId = await createBotPhoto({
    createdByEmail: input.email,
    flowerType: input.flowerType,
    variety,
    grade,
    caption,
    fileId,
    fileName,
  });
  console.log(`Добавлено: ${photoId}, файл ${fileId}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
