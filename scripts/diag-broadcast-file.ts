import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

/**
 * Почему рассылка пишет «Green API не ответил»: что у рассылки за файл, как быстро наш сайт его отдаёт (Green API
 * скачивает картинку по ссылке, пока мы ждём ответа 20 с) и сколько сегодня ушло исходящих. Ничего не меняет.
 *
 *   npx tsx scripts/diag-broadcast-file.ts --id-file <файл>
 */
import { readFileSync } from "node:fs";
import { listBroadcasts, listRecipients } from "../src/lib/repo/broadcasts";
import { publicFileUrl } from "../src/lib/waFileSign";
import { SITE } from "../src/lib/broadcastSend";
import { isSpecialFile } from "../src/lib/botPhotos";
import { greenConfig } from "../src/lib/greenApi";
import { localDayKey } from "../src/lib/timezone";

async function main() {
  const args = process.argv.slice(2);
  const fi = args.indexOf("--id-file");
  const id = (fi >= 0 ? readFileSync(args[fi + 1], "utf8").trim() : "") || args.find((a) => a.startsWith("BC-")) || "";
  const b = (await listBroadcasts(true)).find((x) => x.broadcastId === id);
  if (!b) throw new Error("рассылка не найдена");
  console.log(`Рассылка ${id}: статус ${b.status}, файл «${b.fileId || "нет"}» ${b.fileName || ""}, последняя попытка ${b.lastSendAt}`);
  const rec = (await listRecipients(true)).filter((r) => r.broadcastId === id);
  const today = localDayKey();
  const by = new Map<string, number>();
  for (const r of rec) by.set(r.status, (by.get(r.status) ?? 0) + 1);
  console.log(`Получатели: ${Array.from(by).map(([k, v]) => `${k} ${v}`).join(", ")}`);
  const sentToday = rec.filter((r) => r.status === "sent" && r.sentAt && localDayKey(new Date(r.sentAt)) === today);
  console.log(`Отправлено сегодня: ${sentToday.length}; последние: ${sentToday.map((r) => r.sentAt.slice(11, 16)).slice(-5).join(", ")}`);
  const errs = rec.filter((r) => r.status === "error").slice(-5);
  for (const e of errs) console.log(`  ошибка …${e.phone.slice(-4)}: ${e.error}`);

  if (b.fileId && !isSpecialFile(b.fileId)) {
    const url = publicFileUrl(SITE(), b.fileId, b.fileName);
    for (let i = 1; i <= 3; i++) {
      const t0 = Date.now();
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(40000), cache: "no-store" });
        const buf = await res.arrayBuffer();
        console.log(`Файл с сайта, попытка ${i}: код ${res.status}, ${Math.round(buf.byteLength / 1024)} КБ, ${Date.now() - t0} мс`);
      } catch (e) {
        console.log(`Файл с сайта, попытка ${i}: нет ответа за ${Date.now() - t0} мс (${e instanceof Error ? e.message : e})`);
      }
    }
  }

  const cfg = greenConfig();
  if (!cfg) return;
  for (const m of ["getStateInstance", "getWaSettings"]) {
    const t0 = Date.now();
    try {
      const res = await fetch(`${cfg.url}/waInstance${cfg.instance}/${m}/${cfg.token}`, { signal: AbortSignal.timeout(20000) });
      const text = (await res.text()).split(cfg.token).join("***");
      console.log(`${m}: ${res.status} за ${Date.now() - t0} мс · ${text.slice(0, 160)}`);
    } catch (e) {
      console.log(`${m}: нет ответа за ${Date.now() - t0} мс`);
    }
  }
  try {
    const res = await fetch(`${cfg.url}/waInstance${cfg.instance}/lastOutgoingMessages/${cfg.token}?minutes=240`, { signal: AbortSignal.timeout(30000) });
    const list = (await res.json()) as { timestamp: number; statusMessage?: string; sendByApi?: boolean; typeMessage?: string }[];
    console.log(`Исходящие за 4 ч (Green API): ${list.length}`);
    for (const m of list.slice(0, 12)) {
      const t = new Date(m.timestamp * 1000).toLocaleTimeString("ru-RU", { timeZone: "Asia/Almaty" });
      console.log(`  ${t} ${m.typeMessage} ${m.statusMessage} ${m.sendByApi ? "API" : "телефон"}`);
    }
  } catch (e) {
    console.log(`lastOutgoingMessages: ${e instanceof Error ? e.message : e}`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
