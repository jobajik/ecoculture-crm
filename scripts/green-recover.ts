import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

/**
 * Green API «завис»: номер authorized/online, а отправка и очередь не отвечают (14.10.2026 с ~12:00).
 * Порядок: рассылка — на паузу; перезапуск инстанса (`reboot`, номер не отвязывается); ждём authorized;
 * очищаем очередь исходящих (копившиеся повторы не уйдут пачкой одному клиенту); проба на НАШ ЖЕ номер.
 * Проба прошла и указан `--resume` — рассылка продолжается.
 *
 *   npx tsx scripts/green-recover.ts --id-file <файл рассылки> [--resume]
 */
import { readFileSync } from "node:fs";
import { commitAtomic } from "../src/lib/sheets";
import { broadcastUpdate, findBroadcastRow } from "../src/lib/repo/broadcasts";
import { BROADCAST_STATUSES } from "../src/lib/broadcast";
import { greenConfig } from "../src/lib/greenApi";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function call(method: string, body?: unknown, timeoutMs = 30000) {
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

const show = (m: string, r: { status: number; ms: number; text: string }) => console.log(`${m}: ${r.status} за ${r.ms} мс · ${r.text.slice(0, 200)}`);

async function setStatus(id: string, status: string, note: string) {
  const found = await findBroadcastRow(id);
  if (!found) throw new Error("рассылка не найдена");
  await commitAtomic([broadcastUpdate(found.rowNumber, { Status: status, Note: note })]);
  console.log(`Рассылка ${id}: ${status}${note ? ` (${note})` : ""}`);
}

async function main() {
  if (!greenConfig()) throw new Error("нет ключей Green API");
  const args = process.argv.slice(2);
  const fi = args.indexOf("--id-file");
  const id = fi >= 0 ? readFileSync(args[fi + 1], "utf8").trim() : "";
  if (!id) throw new Error("нужен --id-file");

  await setStatus(id, BROADCAST_STATUSES.PAUSED, "Green API не отправлял — перезапуск");

  show("reboot", await call("reboot"));
  let authorized = false;
  for (let i = 0; i < 24; i++) {
    await sleep(5000);
    const r = await call("getStateInstance", undefined, 10000);
    if (r.text.includes("authorized")) {
      authorized = true;
      console.log(`номер снова authorized через ${(i + 1) * 5} с`);
      break;
    }
    if (i % 4 === 0) show("getStateInstance", r);
  }
  if (!authorized) {
    console.log("Номер не вернулся в authorized за 2 минуты — рассылка остаётся на паузе.");
    return;
  }
  show("clearMessagesQueue", await call("clearMessagesQueue"));
  show("showMessagesQueue", await call("showMessagesQueue"));

  const st = await call("getWaSettings", undefined, 15000);
  const own = (st.text.match(/"phone":"(\d+)"/) || [])[1] || "";
  if (!own) return console.log("не узнал свой номер — проба не отправлена, рассылка на паузе");
  const probe = await call("sendMessage", { chatId: `${own}@c.us`, message: "Проверка связи CRM после перезапуска — можно удалить" }, 30000);
  show("проба sendMessage (наш номер)", probe);
  const ok = probe.status === 200 && probe.text.includes("idMessage");
  if (!ok) return console.log("Отправка всё ещё не работает — рассылка на паузе. Нужно писать в поддержку Green API.");
  if (args.includes("--resume")) await setStatus(id, BROADCAST_STATUSES.SENDING, "");
  else console.log("Отправка работает. Продолжить рассылку: --resume");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
