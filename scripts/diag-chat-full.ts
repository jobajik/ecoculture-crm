import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

/**
 * Вся переписка номера с клиентом: сохранённое в CRM + история чата из Green API, голосовые — расшифровкой (только показ,
 * в таблицу НЕ пишется). Для разбора «о чём договорились» (23.10.2026: «по 190» на номере Салтанат — про что?).
 * Телефон клиента — последние 4 цифры.
 *
 *   npx tsx scripts/diag-chat-full.ts <код линии | main> <последние цифры> [сколько из Green API, по умолчанию 200]
 */
import { listWaMessages } from "../src/lib/repo/talks";
import { lineConfig } from "../src/lib/repo/waLines";
import { fetchChatHistory, downloadMedia, messageFileUrl } from "../src/lib/greenApi";
import { transcribeAudio } from "../src/lib/openai";
import { mergeMessages, messageText } from "../src/lib/whatsapp";

async function main() {
  const [codeRaw, tail, countRaw] = process.argv.slice(2);
  if (!codeRaw || !tail) throw new Error("нужны код линии и цифры");
  const code = codeRaw === "main" ? "" : codeRaw;
  const stored = (await listWaMessages({ lines: "all", fresh: true })).filter((m) => (m.line || "") === code && m.phone.replace(/\D/g, "").endsWith(tail));
  const phone = stored[0]?.phone || "";
  if (!phone) throw new Error("в CRM такого чата на этом номере нет");
  const cfg = await lineConfig(code);
  let pulled: typeof stored = [];
  if (cfg) {
    try {
      pulled = (await fetchChatHistory(cfg, phone, Number(countRaw) || 200, 30000)).map((m) => ({ ...m, line: code }));
    } catch (e) {
      console.log(`Green API историю не отдал: ${e instanceof Error ? e.message : e}`);
    }
  }
  const chat = mergeMessages([...stored, ...pulled]);
  console.log(`Номер «${code || "основной"}», клиент …${tail}: в CRM ${stored.length}, из Green API ${pulled.length}, всего ${chat.length}\n`);
  for (const m of chat) {
    let text = messageText(m);
    if (m.type === "voice" && !m.text) {
      try {
        const url = m.mediaUrl || (cfg ? await messageFileUrl(cfg, phone, m.messageId) : "");
        const f = url ? await downloadMedia(url) : null;
        text = f ? `[голосовое, расшифровка] ${await transcribeAudio(f.data, f.mime)}` : "[голосовое — файл недоступен]";
      } catch (e) {
        text = `[голосовое — не расшифровалось: ${e instanceof Error ? e.message : e}]`;
      }
    }
    const t = new Date(m.at).toLocaleString("ru-RU", { timeZone: "Asia/Almaty", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
    console.log(`${t} ${m.direction === "in" ? "КЛИЕНТ" : "мы    "} [${m.source}] ${text.replace(/\s+/g, " ").slice(0, 400)}`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
