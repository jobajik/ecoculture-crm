/*
 * Номер менеджера после перепривязки: несколько замеров подряд — загрузка истории (historySyncProgress),
 * что Green API отдаёт в getSettings (сырые поля, ключ и токен скрыты), журнал входящих/исходящих за 15 мин.
 * Ничего не меняет. Запуск: npx tsx scripts/line-sync-watch.ts <код линии> [замеров] [секунд между]
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { listWaLines, managerLineConfig } from "../src/lib/repo/waLines";

const hide = (s: string, token: string) =>
  s.split(token).join("***").replace(/key=[0-9a-f]+/gi, "key=…").replace(/"webhookUrlToken":"[^"]*"/, '"webhookUrlToken":"…"');

async function main() {
  const [code, nRaw, gapRaw] = process.argv.slice(2);
  const cfg = managerLineConfig((await listWaLines({ fresh: true })).find((l) => l.code === code));
  if (!cfg) throw new Error(`нет ключей линии ${code}`);
  const get = async (method: string, q = "") => {
    try {
      const res = await fetch(`${cfg.url}/waInstance${cfg.instance}/${method}/${cfg.token}${q}`, { signal: AbortSignal.timeout(20000) });
      return { status: res.status, text: hide(await res.text(), cfg.token) };
    } catch (e) {
      return { status: 0, text: String(e) };
    }
  };
  const n = Math.max(1, Number(nRaw) || 4);
  const gap = Math.max(10, Number(gapRaw) || 90);
  for (let i = 0; i < n; i++) {
    if (i) await new Promise((r) => setTimeout(r, gap * 1000));
    const s = await get("getSettings");
    const wa = await get("getWaSettings");
    const prog = /"historySyncProgress":(\d+)/.exec(wa.text)?.[1] ?? "?";
    const count = async (m: string) => {
      const r = await get(m, "?minutes=15");
      try {
        return String((JSON.parse(r.text) as unknown[]).length);
      } catch {
        return `${r.status} ${r.text.slice(0, 40)}`;
      }
    };
    console.log(`\n[${new Date().toISOString().slice(11, 19)}] загрузка истории ${prog}% · входящих за 15 мин ${await count("lastIncomingMessages")} · исходящих ${await count("lastOutgoingMessages")}`);
    console.log(`getSettings ${s.status}: ${s.text.slice(0, 900)}`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
