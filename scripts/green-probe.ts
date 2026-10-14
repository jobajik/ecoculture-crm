import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

/**
 * Проба отправки на НАШ ЖЕ номер несколько раз с паузой: ожил ли Green API после перезапуска. Клиентам ничего не уходит.
 * Ожил и указан `--resume` — очередь очищается и рассылка продолжается.
 *
 *   npx tsx scripts/green-probe.ts --id-file <файл рассылки> [--tries N] [--resume]
 */
import { readFileSync } from "node:fs";
import { commitAtomic } from "../src/lib/sheets";
import { broadcastUpdate, findBroadcastRow } from "../src/lib/repo/broadcasts";
import { BROADCAST_STATUSES } from "../src/lib/broadcast";
import { greenConfig } from "../src/lib/greenApi";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function call(method: string, body?: unknown, timeoutMs = 20000) {
  const cfg = greenConfig()!;
  const t0 = Date.now();
  try {
    const res = await fetch(`${cfg.url}/waInstance${cfg.instance}/${method}/${cfg.token}`, {
      method: body === undefined ? "GET" : "POST",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = (await res.text()).split(cfg.token).join("***");
    return { status: res.status, ms: Date.now() - t0, text };
  } catch (e) {
    return { status: 0, ms: Date.now() - t0, text: e instanceof Error ? e.message : String(e) };
  }
}

async function main() {
  if (!greenConfig()) throw new Error("нет ключей Green API");
  const args = process.argv.slice(2);
  const fi = args.indexOf("--id-file");
  const id = fi >= 0 ? readFileSync(args[fi + 1], "utf8").trim() : "";
  const ti = args.indexOf("--tries");
  const tries = ti >= 0 ? Number(args[ti + 1]) || 5 : 5;
  const st = await call("getWaSettings");
  const own = (st.text.match(/"phone":"(\d+)"/) || [])[1] || "";
  console.log(`состояние: ${(await call("getStateInstance")).text} · ${(await call("getStatusInstance")).text}`);
  if (!own) throw new Error("не узнал свой номер");
  let ok = false;
  for (let i = 1; i <= tries && !ok; i++) {
    const q = await call("showMessagesQueue");
    const p = await call("sendMessage", { chatId: `${own}@c.us`, message: `Проверка связи CRM ${i} — можно удалить` });
    const t = new Date().toLocaleTimeString("ru-RU", { timeZone: "Asia/Almaty" });
    console.log(`${t} попытка ${i}: очередь ${q.status} (${q.text.slice(0, 60)}) · отправка ${p.status} за ${p.ms} мс (${p.text.slice(0, 80)})`);
    ok = p.status === 200 && p.text.includes("idMessage");
    if (!ok && i < tries) await sleep(45000);
  }
  if (!ok) return console.log("Отправка не работает — рассылка остаётся на паузе.");
  console.log("Отправка работает.");
  if (args.includes("--resume") && id) {
    const c = await call("clearMessagesQueue");
    console.log(`clearMessagesQueue: ${c.status} ${c.text.slice(0, 80)}`);
    const found = await findBroadcastRow(id);
    if (found) {
      await commitAtomic([broadcastUpdate(found.rowNumber, { Status: BROADCAST_STATUSES.SENDING, Note: "" })]);
      console.log(`Рассылка ${id} продолжена.`);
    }
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
