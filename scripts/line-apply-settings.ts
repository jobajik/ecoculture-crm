/*
 * По совету поддержки Green API: setSettings (адрес с ключом номера, incoming/outgoing уведомления), затем
 * ждать до 6 минут, раз в минуту смотреть, что отдаёт getSettings; не применилось — Reboot и ещё 4 минуты.
 * Ключ и токены не печатает. Запуск: npx tsx scripts/line-apply-settings.ts <код линии>
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { listWaLines, managerLineConfig } from "../src/lib/repo/waLines";
import { lineHookKey } from "../src/lib/secretBox";

const SITE = "https://www.crm-ecoculture.kz";

async function main() {
  const code = process.argv[2] || "";
  const cfg = managerLineConfig((await listWaLines({ fresh: true })).find((l) => l.code === code));
  if (!cfg) throw new Error(`нет ключей линии ${code}`);
  const base = `${cfg.url}/waInstance${cfg.instance}`;
  const req = async (method: string, body?: unknown, q = "") => {
    try {
      const res = await fetch(`${base}/${method}/${cfg.token}${q}`, {
        method: body === undefined ? "GET" : "POST",
        headers: body === undefined ? undefined : { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(30000),
      });
      return { status: res.status, text: (await res.text()).split(cfg.token).join("***") };
    } catch (e) {
      return { status: 0, text: String(e) };
    }
  };
  const look = async () => {
    const s = await req("getSettings");
    let o: Record<string, unknown> = {};
    try {
      o = JSON.parse(s.text);
    } catch {
      /* как есть */
    }
    const wa = await req("getWaSettings");
    const prog = /"historySyncProgress":(\d+)/.exec(wa.text)?.[1] ?? "?";
    const st = /"stateInstance":"(\w+)"/.exec(wa.text)?.[1] ?? "?";
    const inc = await req("lastIncomingMessages", undefined, "?minutes=30");
    let n = "?";
    try {
      n = String((JSON.parse(inc.text) as unknown[]).length);
    } catch {
      n = `${inc.status}`;
    }
    const ok = !!o.webhookUrl && o.incomingWebhook === "yes";
    console.log(
      `[${new Date().toISOString().slice(11, 19)}] ${st}, история ${prog}% · адрес ${o.webhookUrl ? "ЕСТЬ" : "пусто"}, incoming=${o.incomingWebhook}, outgoingMessage=${o.outgoingMessageWebhook}, outgoing=${o.outgoingWebhook}, delay=${o.delaySendMessagesMilliseconds} · входящих за 30 мин: ${n}`
    );
    return ok;
  };
  const sleep = (s: number) => new Promise((r) => setTimeout(r, s * 1000));
  const body = {
    webhookUrl: `${SITE}/api/whatsapp/webhook?line=${encodeURIComponent(code)}&key=${lineHookKey(code)}`,
    webhookUrlToken: "",
    incomingWebhook: "yes",
    outgoingMessageWebhook: "yes",
    outgoingAPIMessageWebhook: "yes",
    outgoingWebhook: "yes",
  };
  await look();
  const set = await req("setSettings", body);
  console.log(`setSettings ${set.status}: ${set.text.slice(0, 200)}`);
  for (let i = 1; i <= 6; i++) {
    await sleep(60);
    if (await look()) return console.log("ПРИМЕНИЛОСЬ");
  }
  const rb = await req("reboot");
  console.log(`reboot ${rb.status}: ${rb.text.slice(0, 120)}`);
  await sleep(60);
  const set2 = await req("setSettings", body);
  console.log(`setSettings ${set2.status}: ${set2.text.slice(0, 200)}`);
  for (let i = 1; i <= 4; i++) {
    await sleep(60);
    if (await look()) return console.log("ПРИМЕНИЛОСЬ");
  }
  console.log("НЕ ПРИМЕНИЛОСЬ");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
