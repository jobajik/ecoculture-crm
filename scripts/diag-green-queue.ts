import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

/**
 * Очередь исходящих Green API: что ждёт отправки (номер — последние 4 цифры, тип, начало текста) и связь с
 * телефоном. `--clear` — очистить очередь (ничего из неё не уйдёт). 14.10.2026: отправка висела, проверка номера
 * отвечала «authorized», а сообщения не уходили.
 *
 *   npx tsx scripts/diag-green-queue.ts [--clear]
 */
import { greenConfig } from "../src/lib/greenApi";

async function call(method: string, init?: RequestInit) {
  const cfg = greenConfig()!;
  const t0 = Date.now();
  try {
    const res = await fetch(`${cfg.url}/waInstance${cfg.instance}/${method}/${cfg.token}`, { ...init, signal: AbortSignal.timeout(30000) });
    const text = (await res.text()).split(cfg.token).join("***");
    return { ok: res.ok, status: res.status, ms: Date.now() - t0, text };
  } catch (e) {
    return { ok: false, status: 0, ms: Date.now() - t0, text: e instanceof Error ? e.message : String(e) };
  }
}

async function main() {
  if (!greenConfig()) throw new Error("нет ключей Green API");
  for (const m of ["getStateInstance", "getStatusInstance"]) {
    const r = await call(m);
    console.log(`${m}: ${r.status} за ${r.ms} мс · ${r.text.slice(0, 200)}`);
  }
  const q = await call("showMessagesQueue");
  console.log(`showMessagesQueue: ${q.status} за ${q.ms} мс`);
  try {
    const list = JSON.parse(q.text) as { chatId?: string; typeMessage?: string; body?: { message?: string; caption?: string } }[];
    console.log(`В очереди: ${list.length}`);
    const by = new Map<string, number>();
    for (const m of list) {
      const k = `…${String(m.chatId || "").replace(/\D/g, "").slice(-4)} ${m.typeMessage || ""}`;
      by.set(k, (by.get(k) ?? 0) + 1);
    }
    for (const [k, n] of by) console.log(`  ${k}: ${n}`);
    for (const m of list.slice(0, 5)) console.log(`  · ${(m.body?.message || m.body?.caption || "").slice(0, 70).replace(/\n/g, " ")}`);
  } catch {
    console.log(q.text.slice(0, 300));
  }
  if (process.argv.includes("--clear")) {
    const c = await call("clearMessagesQueue");
    console.log(`clearMessagesQueue: ${c.status} за ${c.ms} мс · ${c.text.slice(0, 200)}`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
