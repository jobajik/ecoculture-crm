import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

/**
 * Расшифровать голосовое (ogg/mp3/m4a/wav) тем же OpenAI, что голосовые WhatsApp, — текст в файл рядом
 * (`<имя>.txt`). Для голосовых владельца, присланных в чат Claude (в контейнере расшифровать нечем).
 *   npx tsx scripts/transcribe-file.ts <путь к файлу>
 */
import { readFileSync, writeFileSync } from "node:fs";
import { transcribeAudio } from "../src/lib/openai";

async function main() {
  const file = process.argv[2];
  if (!file) throw new Error("нужен путь к файлу");
  const buf = readFileSync(file);
  const mime = /\.mp3$/i.test(file) ? "audio/mpeg" : /\.(m4a|mp4)$/i.test(file) ? "audio/mp4" : /\.wav$/i.test(file) ? "audio/wav" : "audio/ogg";
  const text = await transcribeAudio(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), mime);
  const out = file.replace(/\.[^.]+$/, "") + ".txt";
  writeFileSync(out, text, "utf8");
  console.log(`Расшифровано: ${text.length} знаков → ${out}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
