import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();
/**
 * Кому за последние дни УШЛО сообщение рассылки с таким текстом: все названные куски должны быть в одной строке
 * сообщения (регистр не важен). Нужно, когда среди дня поменяли цену: кто успел получить прежнюю. Ничего не меняет.
 *   npx tsx scripts/diag-broadcast-text.ts [дней=1] <кусок> [кусок …]     пример: 1 "Эустома" "50 см" "150 ₸"   или   1 @куски.txt
 */
import { readFileSync } from "fs";
import { listBroadcasts, listRecipients } from "../src/lib/repo/broadcasts";
import { localDayKey } from "../src/lib/timezone";

async function main() {
  const args = process.argv.slice(2);
  const days = /^\d+$/.test(args[0] || "") ? Number(args.shift()) : 1;
  // «@файл» — куски из файла, по одному в строке: в .bat очереди кириллицу писать нельзя.
  const raw = args.flatMap((a) => (a.startsWith("@") ? readFileSync(a.slice(1), "utf-8").replace(/^\uFEFF/, "").split(/\r?\n/).map((x) => x.trim()).filter(Boolean) : [a]));
  const parts = raw.map((a) => a.toLowerCase().replace(/[\u00a0\u202f]/g, " "));
  if (!parts.length) throw new Error("Назовите хотя бы один кусок текста");
  const from = localDayKey(new Date(Date.now() - (days - 1) * 86400000));
  const [broadcasts, recipients] = await Promise.all([listBroadcasts(true), listRecipients(true)]);
  const byId = new Map(broadcasts.map((b) => [b.broadcastId, b]));
  const hit = recipients
    .filter((r) => r.status === "sent" && r.sentAt && localDayKey(new Date(r.sentAt)) >= from)
    .map((r) => ({ r, b: byId.get(r.broadcastId), line: (r.text || byId.get(r.broadcastId)?.text || "").split("\n").find((l) => parts.every((p) => l.toLowerCase().replace(/[\u00a0\u202f]/g, " ").includes(p))) }))
    .filter((x) => x.line)
    .sort((a, b) => a.r.sentAt.localeCompare(b.r.sentAt));
  console.log(`С ${from}: ушло с такой строкой — ${hit.length}`);
  for (const x of hit) {
    const t = new Date(x.r.sentAt).toLocaleString("ru-RU", { timeZone: "Asia/Almaty", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
    console.log(`  ${t} · ${(x.r.name || "без имени").split(/\s+/)[0]} …${x.r.phone.slice(-4)} · ${x.b?.title || x.r.broadcastId} · ${x.line!.trim()}`);
  }
}

main().catch((e) => {
  console.error("ОШИБКА:", e instanceof Error ? e.message : e);
  process.exit(1);
});
