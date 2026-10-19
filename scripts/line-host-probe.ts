/*
 * Номер менеджера: на какой адрес Green API ходит CRM и принимает ли настройки «родной» адрес инстанса
 * (первые 4 цифры idInstance: 7103… → https://7103.api.greenapi.com). С --set пишет адрес уведомлений
 * через родной адрес и, если он принял, сохраняет его в номере. Токены не печатает.
 * Запуск: npx tsx scripts/line-host-probe.ts <код линии> [--set]
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { listWaLines, managerLineConfig, saveWaLine } from "../src/lib/repo/waLines";
import { configureWebhook } from "../src/lib/greenApi";

const pause = (s: number) => new Promise((r) => setTimeout(r, s * 1000));

async function main() {
  const code = process.argv[2] || "";
  const doSet = process.argv.includes("--set");
  const line = (await listWaLines({ fresh: true })).find((l) => l.code === code);
  const cfg = managerLineConfig(line);
  if (!line || !cfg) throw new Error("нет линии или ключа");
  const native = `https://${cfg.instance.slice(0, 4)}.api.greenapi.com`;
  console.log(`В CRM записан адрес: ${line.url || "(пусто → https://api.green-api.com)"}; idInstance начинается на ${cfg.instance.slice(0, 4)}; родной: ${native}`);
  const settingsAt = async (host: string) => {
    try {
      const res = await fetch(`${host}/waInstance${cfg.instance}/getSettings/${cfg.token}`, { signal: AbortSignal.timeout(20000) });
      const t = (await res.text()).split(cfg.token).join("***");
      const o = JSON.parse(t) as Record<string, unknown>;
      return `${res.status} адрес ${o.webhookUrl ? "есть" : "ПУСТО"} incoming=${o.incomingWebhook} wid=${String(o.wid || "").slice(-6)}`;
    } catch (e) {
      return `ошибка: ${e instanceof Error ? e.message : e}`;
    }
  };
  for (const host of Array.from(new Set([cfg.url, native, "https://api.green-api.com"]))) console.log(`${host}: ${await settingsAt(host)}`);
  if (!doSet) return;
  const hook = `https://www.crm-ecoculture.kz/api/whatsapp/webhook?line=${encodeURIComponent(code)}`;
  const r = await configureWebhook({ ...cfg, url: native }, hook, (process.env.WHATSAPP_WEBHOOK_TOKEN || "").trim());
  console.log("setSettings через родной адрес:", JSON.stringify(r));
  await pause(20);
  const after = await settingsAt(native);
  console.log(`через 20 с (родной): ${after}`);
  if (after.includes("адрес есть") && line.url !== native) {
    await saveWaLine({ ...line, url: native, updatedAt: new Date().toISOString() });
    console.log(`Адрес Green API в CRM исправлен на ${native}`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
