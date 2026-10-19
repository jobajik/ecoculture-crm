/*
 * Сравнить инстансы Green API: основной номер, номер Земфиры и номера менеджеров — адрес сервера, адрес
 * уведомлений, тип аккаунта, журнал входящих за час. Ничего не меняет, токены не печатает.
 * Запуск: npx tsx scripts/diag-green-compare.ts
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { greenConfig, greenLeadsConfig, type GreenConfig } from "../src/lib/greenApi";
import { listWaLines, managerLineConfig } from "../src/lib/repo/waLines";

async function show(name: string, cfg: GreenConfig | null) {
  if (!cfg) return console.log(`${name}: нет ключей`);
  const get = async (method: string, q = "") => {
    try {
      const res = await fetch(`${cfg.url}/waInstance${cfg.instance}/${method}/${cfg.token}${q}`, { signal: AbortSignal.timeout(20000) });
      return { status: res.status, text: (await res.text()).split(cfg.token).join("***") };
    } catch (e) {
      return { status: 0, text: String(e) };
    }
  };
  const s = await get("getSettings");
  let o: Record<string, unknown> = {};
  try {
    o = JSON.parse(s.text);
  } catch {
    /* ниже покажем как есть */
  }
  const inc = await get("lastIncomingMessages", "?minutes=120");
  let incN = "?";
  try {
    incN = String((JSON.parse(inc.text) as unknown[]).length);
  } catch {
    incN = inc.text.slice(0, 60);
  }
  const wa = await get("getWaSettings");
  console.log(
    `${name}: сервер ${cfg.url.replace(/^https:\/\//, "")}, idInstance ${cfg.instance.slice(0, 4)}…, адрес уведомлений ${o.webhookUrl ? "есть" : "ПУСТО"}, incoming=${o.incomingWebhook}, typeAccount=${o.typeAccount || "-"}, входящих за 2 ч: ${incN}`
  );
  console.log(`   getWaSettings: ${wa.status} ${wa.text.replace(/"avatar":"[^"]*"/, '"avatar":"…"').slice(0, 300)}`);
}

async function main() {
  await show("Основной", greenConfig());
  await show("Земфира", greenLeadsConfig());
  for (const l of await listWaLines({ fresh: true })) await show(`${l.code}`, managerLineConfig(l));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
