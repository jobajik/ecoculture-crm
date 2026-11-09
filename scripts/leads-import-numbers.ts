import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

/**
 * Загрузить список НОМЕРОВ лидами (09.11.2026, владелец прислал контакты оптовой группы SKY FLORAL: «сделай рассылку по этим
 * номерам с предложениями по хризе и веди аналитику»). Файл — JSON: { "campaign": "…", "source": "…", "phones": ["+7777…", …],
 * "note": "…" }. Номер приводится к +7XXXXXXXXXX; городские и мусор пропускаются; номер, который уже есть у лида или клиента
 * (`phoneKey`), не заводится второй раз. Имя — «<кампания> …XXXX» (владелец видит хвост номера), менеджер — ничей (ответы
 * ведёт бот основного номера), стадия «Новый». Без --yes — показ.
 *
 *   npx tsx scripts/leads-import-numbers.ts <json> [--yes]
 */
import { readFileSync } from "node:fs";
import { prefetchTables, SHEET_TABS } from "../src/lib/sheets";
import { createLeads, listLeadsStrict } from "../src/lib/repo/leads";
import { listClientsStrict } from "../src/lib/repo/clients";
import { phoneKey } from "../src/lib/leads";
import { waPhone } from "../src/lib/broadcast";
import { ourPhoneKeys } from "../src/lib/lineNotify";
import { settingsMap } from "../src/lib/repo/broadcasts";

const OWNER = "y.sadakbayev@gmail.com";

async function main() {
  const file = process.argv.slice(2).find((a) => !a.startsWith("--"));
  const yes = process.argv.includes("--yes");
  if (!file) throw new Error("Укажите файл JSON");
  const spec = JSON.parse(readFileSync(file, "utf8").replace(/^﻿/, "")) as { campaign: string; source?: string; phones: string[]; note?: string; city?: string };
  if (!spec.campaign || !Array.isArray(spec.phones)) throw new Error("В файле нужны campaign и phones");

  await prefetchTables([SHEET_TABS.LEADS, SHEET_TABS.CLIENTS, SHEET_TABS.USERS, SHEET_TABS.SETTINGS]);
  const [leads, clients, ours] = await Promise.all([listLeadsStrict(), listClientsStrict(), ourPhoneKeys(await settingsMap())]);
  const known = new Map<string, string>();
  for (const c of clients) for (const p of [c.phone, c.kaspiPay1, c.kaspiPay2]) if (phoneKey(p)) known.set(phoneKey(p), `клиент ${c.name}`);
  for (const l of leads) if (phoneKey(l.phone)) known.set(phoneKey(l.phone), `лид ${l.name}${l.campaign ? ` (${l.campaign})` : ""}`);

  const seen = new Set<string>();
  const fresh: string[] = [];
  const skipped: { phone: string; why: string }[] = [];
  for (const raw of spec.phones) {
    const wa = waPhone(raw);
    if (!wa) {
      skipped.push({ phone: String(raw), why: "не мобильный номер" });
      continue;
    }
    const key = phoneKey(wa);
    if (seen.has(key)) {
      skipped.push({ phone: wa, why: "повтор в файле" });
      continue;
    }
    seen.add(key);
    if (ours.has(key)) {
      skipped.push({ phone: wa, why: "наш сотрудник" });
      continue;
    }
    const k = known.get(key);
    if (k) {
      skipped.push({ phone: wa, why: `уже есть: ${k}` });
      continue;
    }
    fresh.push(wa);
  }
  console.log(`В файле ${spec.phones.length}, новых ${fresh.length}, пропущено ${skipped.length}`);
  const byWhy = new Map<string, number>();
  for (const s of skipped) byWhy.set(s.why.split(":")[0], (byWhy.get(s.why.split(":")[0]) ?? 0) + 1);
  for (const [w, n] of byWhy) console.log(`  ${w}: ${n}`);
  for (const s of skipped.filter((x) => x.why.startsWith("уже есть")).slice(0, 15)) console.log(`    …${s.phone.slice(-4)} — ${s.why}`);
  if (!yes) return console.log("\nТолько показ. Записать — с --yes.");
  if (!fresh.length) return console.log("Заводить нечего.");

  const n = await createLeads(
    fresh.map((p) => ({
      createdByEmail: OWNER,
      name: `${spec.campaign} …${p.slice(-4)}`,
      city: spec.city ?? "",
      contactPerson: "",
      phone: `+${p}`,
      clientType: "",
      source: spec.source ?? "Другое",
      address: "",
      note: spec.note ?? `Номер из списка «${spec.campaign}»`,
      managerEmail: "",
      campaign: spec.campaign,
      segment: "Рассылка",
    }))
  );
  console.log(`Заведено лидов: ${n} (кампания «${spec.campaign}»)`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
