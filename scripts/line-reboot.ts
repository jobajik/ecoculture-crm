/*
 * Номер менеджера не принимает настройки (адрес уведомлений пустой после setSettings) и не видит входящих:
 * перезапустить инстанс Green API (номер не отвязывается), заново прописать адрес уведомлений и проверить.
 * Токены не печатает. Запуск: npx tsx scripts/line-reboot.ts <код линии>
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { listWaLines, managerLineConfig } from "../src/lib/repo/waLines";
import { configureWebhook } from "../src/lib/greenApi";

const pause = (s: number) => new Promise((r) => setTimeout(r, s * 1000));

async function main() {
  const code = process.argv[2] || "";
  const line = (await listWaLines({ fresh: true })).find((l) => l.code === code);
  const cfg = managerLineConfig(line);
  if (!line || !cfg) throw new Error("нет линии или ключа");
  const get = async (method: string, q = "") => {
    const res = await fetch(`${cfg.url}/waInstance${cfg.instance}/${method}/${cfg.token}${q}`, { signal: AbortSignal.timeout(40000) });
    return { status: res.status, text: (await res.text()).split(cfg.token).join("***") };
  };
  console.log("reboot:", (await get("reboot")).text.slice(0, 200));
  for (let i = 0; i < 12; i++) {
    await pause(10);
    const st = await get("getStateInstance").catch((e) => ({ status: 0, text: String(e) }));
    console.log(`через ${(i + 1) * 10} с: ${st.text.slice(0, 120)}`);
    if (st.text.includes("authorized") && !st.text.includes("notAuthorized")) break;
  }
  const hook = `https://www.crm-ecoculture.kz/api/whatsapp/webhook?line=${encodeURIComponent(code)}`;
  console.log("setSettings:", JSON.stringify(await configureWebhook(cfg, hook, (process.env.WHATSAPP_WEBHOOK_TOKEN || "").trim())));
  for (const wait of [20, 60, 120]) {
    await pause(wait === 20 ? 20 : wait === 60 ? 40 : 60);
    const s = JSON.parse((await get("getSettings")).text) as Record<string, unknown>;
    console.log(`через ${wait} с: адрес ${s.webhookUrl ? "есть" : "ПУСТО"}, incoming=${s.incomingWebhook}, typeAccount=${s.typeAccount || "-"}`);
    if (s.webhookUrl) break;
  }
  const inc = JSON.parse((await get("lastIncomingMessages", "?minutes=60")).text) as unknown[];
  console.log(`входящих в журнале за 60 мин: ${inc.length}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
