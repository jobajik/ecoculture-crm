import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

/**
 * Завести рассылку по клиентской базе без браузера и (с --yes) сразу запустить.
 * Аргументы — JSON в UTF-8 (русские слова из .bat портятся):
 *   { "title": "…", "text": "… {имя} … {цены хризантема Altaj} …", "fileId": "F-…", "fileName": "….jpg",
 *     "skipOrderedDays": 3, "dailyLimit": 40, "email": "кто запустил" }
 *
 * Кому: активные клиенты базы с мобильным (не наши магазины, не отписавшиеся, номер без повторов),
 * кроме заказавших за последние `skipOrderedDays` дня. Порядок: сначала покупавшие — кто дольше не
 * заказывал, выше; потом карточки без заказов. Цены подставляются один раз, как в форме рассылки.
 * Рассылка с тем же названием, которая не остановлена, второй раз не заводится. Без --yes — показ.
 *
 *   npx tsx scripts/broadcast-create.ts <json> [--yes]
 *
 * 08.10.2026, владелец: «бот пусть потихоньку начнёт продажи и рассылки, по 40 клиентов в день».
 * Отправку ведёт `scripts/broadcast-run.ts` (или открытая страница рассылки).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { loadAudience } from "../src/lib/broadcastAudience";
import { OPT_OUT_LINE, effectiveDailyLimit, greetingName, personalize } from "../src/lib/broadcast";
import { withPrices } from "../src/lib/broadcastSend";
import { broadcastUpdate, createBroadcast, findBroadcastRow, listBroadcasts, settingsMap } from "../src/lib/repo/broadcasts";
import { saveSettings } from "../src/lib/repo/settings";
import { commitAtomic } from "../src/lib/sheets";
import { localDayKey } from "../src/lib/timezone";

interface Spec {
  title: string;
  text: string;
  fileId?: string;
  fileName?: string;
  skipOrderedDays?: number;
  dailyLimit?: number;
  email: string;
  /** Куда записать номер рассылки — его читает `broadcast-run.ts --id-file`. */
  idFile?: string;
}

async function main() {
  const spec = JSON.parse(readFileSync(process.argv[2], "utf8").replace(/^﻿/, "")) as Spec;
  const apply = process.argv.includes("--yes");
  const skip = spec.skipOrderedDays ?? 3;

  const all = await listBroadcasts(true);
  for (const b of all.filter((b) => b.status === "sending" || b.status === "paused")) {
    console.log(`Уже есть незаконченная: ${b.broadcastId} «${b.title}» — ${b.status}`);
  }
  const existing = all.find((b) => b.title === spec.title && b.status !== "cancelled");
  if (existing) {
    console.log(`Рассылка «${spec.title}» уже есть: ${existing.broadcastId}, статус ${existing.status} — новую не завожу.`);
    if (spec.idFile) writeFileSync(spec.idFile, existing.broadcastId, "utf8");
    return;
  }

  const audience = (await loadAudience({ withOrders: true })).filter((a) => a.kind === "client");
  const excluded = new Map<string, number>();
  for (const a of audience) if (a.excluded) excluded.set(a.excluded, (excluded.get(a.excluded) ?? 0) + 1);
  const fresh = audience.filter((a) => !a.excluded && a.daysSinceOrder !== null && a.daysSinceOrder < skip);
  const chosen = audience
    .filter((a) => !a.excluded && !(a.daysSinceOrder !== null && a.daysSinceOrder < skip))
    .sort((a, b) => (b.daysSinceOrder ?? -1) - (a.daysSinceOrder ?? -1));
  const buyers = chosen.filter((a) => a.daysSinceOrder !== null).length;

  const raw = (await withPrices(spec.text.replace(/\r/g, ""))).trim();
  const text = /стоп/i.test(raw) ? raw : `${raw}\n\n${OPT_OUT_LINE}`;
  const recipients = chosen.map((a) => ({
    phone: a.waPhone,
    name: greetingName(a.contactPerson, a.name),
    kind: a.kind,
    refId: a.refId,
    managerEmail: a.managerEmail,
  }));

  const map = await settingsMap(true);
  const limitNow = effectiveDailyLimit(String(spec.dailyLimit ?? map.BroadcastDailyLimit ?? ""), map.BroadcastWarmupFrom, localDayKey());
  console.log(`Клиентов в базе: ${audience.length}`);
  for (const [why, n] of excluded) console.log(`  не пойдёт — ${why}: ${n}`);
  console.log(`  заказывали за последние ${skip} дн. — пропускаем: ${fresh.length}`);
  console.log(`Получат: ${recipients.length} (покупали: ${buyers}, без заказов: ${recipients.length - buyers})`);
  console.log(`В день: не больше ${limitNow} → примерно ${Math.ceil(recipients.length / Math.max(1, limitNow))} рабочих дн.`);
  console.log(`Картинка: ${spec.fileName || "нет"} (${spec.fileId || "—"})`);
  console.log("Первые 15:");
  for (const r of recipients.slice(0, 15)) console.log(`  ${r.name || "(без имени)"} · …${r.phone.slice(-4)}`);
  console.log(`\n---ТЕКСТ (пример для «${recipients[0]?.name || ""}»)---\n${personalize(text, recipients[0]?.name || "", false)}\n---КОНЕЦ---`);

  if (!apply) return console.log("\nТолько показ. Запустить: --yes");
  if (recipients.length === 0) return console.log("Получателей нет — не завожу.");
  if (spec.dailyLimit) await saveSettings({ BroadcastDailyLimit: String(spec.dailyLimit) });
  const id = await createBroadcast({
    createdByEmail: spec.email,
    title: spec.title,
    text,
    fileId: spec.fileId || "",
    fileName: spec.fileName || "",
    audience: `Клиенты базы, кроме заказавших за ${skip} дн. (скрипт)`,
    recipients,
  });
  const found = await findBroadcastRow(id, true);
  if (!found) throw new Error("Рассылка не нашлась после записи");
  await commitAtomic([broadcastUpdate(found.rowNumber, { Status: "sending", StartedAt: new Date().toISOString(), Note: "" })]);
  if (spec.idFile) writeFileSync(spec.idFile, id, "utf8");
  console.log(`\nЗаведена и запущена: ${id}, получателей ${recipients.length}. Предел в день: ${spec.dailyLimit ?? "как был"}.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
