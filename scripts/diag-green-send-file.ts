import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

/**
 * Проба: отправляет картинку текущей рассылки (и короткий текст) НА НАШ ЖЕ рабочий номер — клиентам ничего не уходит.
 * Печатает сырой ответ Green API и время. 14.10.2026: рассылка весь день писала «Green API не ответил», номер при этом
 * authorized, а картинка с сайта отдаётся за полсекунды.
 *
 *   npx tsx scripts/diag-green-send-file.ts --id-file <файл>
 */
import { readFileSync } from "node:fs";
import { listBroadcasts } from "../src/lib/repo/broadcasts";
import { publicFileUrl } from "../src/lib/waFileSign";
import { greenConfig } from "../src/lib/greenApi";

async function post(method: string, body: Record<string, unknown>, timeoutMs: number) {
  const cfg = greenConfig()!;
  const t0 = Date.now();
  try {
    const res = await fetch(`${cfg.url}/waInstance${cfg.instance}/${method}/${cfg.token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = (await res.text()).split(cfg.token).join("***");
    console.log(`${method}: код ${res.status} за ${Date.now() - t0} мс · ${text.slice(0, 300)}`);
  } catch (e) {
    console.log(`${method}: нет ответа за ${Date.now() - t0} мс (${e instanceof Error ? e.message : e})`);
  }
}

async function main() {
  const cfg = greenConfig();
  if (!cfg) throw new Error("нет ключей Green API");
  const args = process.argv.slice(2);
  const fi = args.indexOf("--id-file");
  const id = (fi >= 0 ? readFileSync(args[fi + 1], "utf8").trim() : "") || "";
  const b = (await listBroadcasts(true)).find((x) => x.broadcastId === id);
  if (!b || !b.fileId) throw new Error("у рассылки нет файла");
  const st = await (await fetch(`${cfg.url}/waInstance${cfg.instance}/getWaSettings/${cfg.token}`)).json() as { phone?: string };
  const own = String(st.phone || "").replace(/\D/g, "");
  if (!own) throw new Error("не узнал свой номер");
  const chatId = `${own}@c.us`;
  const url = publicFileUrl("https://www.crm-ecoculture.kz", b.fileId, b.fileName);
  console.log(`Проба на свой номер …${own.slice(-4)}, файл ${b.fileName}`);
  await post("sendMessage", { chatId, message: "Проверка связи CRM (рассылка) — можно удалить" }, 30000);
  await post("sendFileByUrl", { chatId, urlFile: url, fileName: "altaj.jpg", caption: "Проверка картинки рассылки — можно удалить" }, 60000);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
