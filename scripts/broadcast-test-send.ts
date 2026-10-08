import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

/**
 * Пробное сообщение рассылки владельцу — тот же текст (с ценами, как ушёл клиентам) и та же
 * картинка, с рабочего номера. Номер — из настройки утренней сводки (`DigestPhones`); если там
 * несколько, берётся тот, что есть и в «Продажах бота» (`BotSalesPhones`). В отчёт рассылки не
 * пишется. Без --yes — показ.
 *
 *   npx tsx scripts/broadcast-test-send.ts (BC-… | --id-file <файл>) [--tail 1234] [--yes]
 *
 * `--tail` — последние цифры номера из сводки, если номеров там несколько.
 *
 * 08.10.2026, владелец: «отправь мне сейчас с этого номера» — посмотреть, как видят клиенты.
 */
import { readFileSync } from "node:fs";
process.env.NEXTAUTH_URL = "https://www.crm-ecoculture.kz"; // ссылка на картинку — на боевой сайт
import { findBroadcastRow, settingsMap } from "../src/lib/repo/broadcasts";
import { deliver, mimeOf } from "../src/lib/broadcastSend";
import { personalize, waPhone } from "../src/lib/broadcast";
import { greenConfig } from "../src/lib/greenApi";
import { publicFileUrl } from "../src/lib/waFileSign";
import { phoneKey } from "../src/lib/leads";

const split = (raw: string | undefined) =>
  String(raw || "")
    .split(/[,;\n]+/)
    .map((p) => waPhone(p))
    .filter(Boolean);

async function main() {
  const args = process.argv.slice(2);
  const fi = args.indexOf("--id-file");
  const id = (fi >= 0 ? readFileSync(args[fi + 1], "utf8").trim() : "") || args.find((a) => a.startsWith("BC-")) || "";
  const found = await findBroadcastRow(id, true);
  if (!found) throw new Error(`Рассылка ${id} не найдена`);
  const b = found.broadcast;

  const map = await settingsMap(true);
  const digest = split(map.DigestPhones);
  const sales = new Set(split(map.BotSalesPhones).map(phoneKey));
  const both = digest.filter((p) => sales.has(phoneKey(p)));
  const ti = args.indexOf("--tail");
  const tail = ti >= 0 ? String(args[ti + 1] || "").replace(/\D/g, "") : "";
  const byTail = tail ? digest.filter((p) => p.endsWith(tail)) : [];
  const phone = tail ? (byTail.length === 1 ? byTail[0] : "") : digest.length === 1 ? digest[0] : both.length === 1 ? both[0] : "";
  console.log(`Номера сводки: ${digest.map((p) => `…${p.slice(-4)}`).join(", ") || "нет"}`);
  if (!phone) throw new Error("Не понял, какой номер ваш — укажите --tail <последние цифры>");
  console.log(`Отправляю на …${phone.slice(-4)}`);

  if (b.fileId) {
    const url = publicFileUrl(process.env.NEXTAUTH_URL!, b.fileId, b.fileName);
    const res = await fetch(url, { method: "GET", signal: AbortSignal.timeout(20000) });
    console.log(`Картинка по ссылке: ${res.status} ${res.headers.get("content-type") || ""}`);
    if (!res.ok) throw new Error("Сайт не отдаёт картинку по этой ссылке — пробное не отправляю");
  }
  const text = personalize(b.text, "Ержан", false);
  console.log(`---ТЕКСТ---\n${text}\n---`);
  if (!args.includes("--yes")) return console.log("Только показ. Отправить: --yes");
  const cfg = greenConfig();
  if (!cfg) throw new Error("Нет ключей Green API");
  const ids = await deliver(cfg, phone, text, b.fileId ? { id: b.fileId, name: b.fileName, mime: mimeOf(b.fileName) } : null);
  console.log(`Отправлено: ${ids.length} сообщ.`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
