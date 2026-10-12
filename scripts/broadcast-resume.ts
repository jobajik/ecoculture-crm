/*
 * Продолжить рассылку, поставленную на паузу (блокировка номера, перепривязка): статус «идёт», заметка паузы
 * стирается. Перед этим — та же проверка номера, что у кнопки «Продолжить» на сайте. Без --yes — только показ.
 *
 *   npx tsx scripts/broadcast-resume.ts <BC-… | --id-file <файл с номером>> [--yes]
 *
 * Отправку дальше ведёт `broadcast-run.ts` (или открытая страница рассылки) — по осторожным правилам сайта:
 * 10:00–19:00, до 15 в час, разогрев.
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { readFileSync } from "node:fs";
import { commitAtomic } from "../src/lib/sheets";
import { broadcastUpdate, findBroadcastRow, listRecipients, settingsMap } from "../src/lib/repo/broadcasts";
import { checkGreenChannel } from "../src/lib/greenChannel";
import { BROADCAST_STATUSES, effectiveDailyLimit } from "../src/lib/broadcast";
import { localDayKey } from "../src/lib/timezone";

async function main() {
  const args = process.argv.slice(2);
  const fi = args.indexOf("--id-file");
  const id = (fi >= 0 ? readFileSync(args[fi + 1], "utf8") : args.find((a) => a.startsWith("BC-")) || "").trim();
  if (!id) throw new Error("нужен номер рассылки");
  const found = await findBroadcastRow(id);
  if (!found) throw new Error(`рассылка ${id} не найдена`);
  const b = found.broadcast;
  const recipients = (await listRecipients(true)).filter((r) => r.broadcastId === id);
  const queued = recipients.filter((r) => r.status === "queued").length;
  const map = await settingsMap(true);
  console.log(`${id} · «${b.title}» · статус ${b.status} · заметка «${b.note || ""}»`);
  console.log(`получателей ${recipients.length}, ждут отправки ${queued}`);
  console.log(
    `разогрев с ${map.BroadcastWarmupFrom || "—"}, сегодня (${localDayKey()}) не больше ${effectiveDailyLimit(map.BroadcastDailyLimit, map.BroadcastWarmupFrom, localDayKey())}`
  );
  if (b.status === BROADCAST_STATUSES.DONE || b.status === BROADCAST_STATUSES.CANCELLED) throw new Error("рассылка уже закончена");
  const c = await checkGreenChannel();
  console.log(`номер: ${c.action}${c.text ? ` — ${c.text}` : ""}`);
  if (c.action === "pause") throw new Error("номер не готов — не продолжаю");
  if (!process.argv.includes("--yes")) return console.log("Только показ. Продолжить: --yes");
  const changes: Record<string, unknown> = { Status: BROADCAST_STATUSES.SENDING, Note: "" };
  if (!b.startedAt) changes.StartedAt = new Date().toISOString();
  await commitAtomic([broadcastUpdate(found.rowNumber, changes)]);
  console.log("Рассылка продолжена.");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
