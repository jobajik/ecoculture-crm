import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

/**
 * Переписать заявку на другого менеджера (продажа и бонус — его), в журнал денег — «Заявка изменена»
 * с кем было и кем стало. 15.10.2026, владелец: «Сделай на Эмиля эту заявку» (№6ND4P, оформил Ильгар).
 * Менеджер — по почте или по имени (первое слово) среди активных сотрудников.
 *
 *   npx tsx scripts/order-set-manager.ts <json {"code":"6ND4P","manager":"Эмиль","reason":"…"}> [--yes]
 */
import { readFileSync } from "node:fs";
import { listOrdersWithItems } from "../src/lib/repo/orders";
import { listUsers } from "../src/lib/repo/users";
import { logMoney } from "../src/lib/repo/moneyLog";
import { updateWhere, SHEET_TABS } from "../src/lib/sheets";
import { orderCode } from "../src/lib/paymentStage";
import { MONEY_LOG_ACTIONS } from "../src/lib/constants";

const OWNER = "y.sadakbayev@gmail.com";
const money = (n: number) => `${Math.round(n).toLocaleString("ru-RU")} ₸`;

async function main() {
  const file = process.argv.slice(2).find((a) => !a.startsWith("--"));
  if (!file) throw new Error("нужен файл JSON");
  const spec = JSON.parse(readFileSync(file, "utf8").replace(/^﻿/, "")) as { code: string; manager: string; reason?: string };
  const code = String(spec.code || "").toUpperCase();
  const want = String(spec.manager || "").trim().toLowerCase();
  const users = (await listUsers()).filter((u) => u.active);
  const first = (n: string) => n.trim().split(/\s+/)[0].toLowerCase();
  const matches = users.filter((u) => u.email.toLowerCase() === want || first(u.name || "") === want);
  if (matches.length !== 1) throw new Error(`менеджер «${spec.manager}»: найдено ${matches.length} — ${matches.map((u) => `${u.name} (${u.role})`).join(", ")}`);
  const to = matches[0];
  const o = (await listOrdersWithItems()).find((x) => orderCode(x.orderId) === code || x.orderId.toUpperCase() === code);
  if (!o) throw new Error(`заявка ${code} не найдена`);
  const fromName = users.find((u) => u.email.toLowerCase() === o.managerEmail.toLowerCase())?.name || o.managerEmail;
  console.log(`№${code} · ${o.clientName} · ${money(o.totalAmount)} · оплачено ${money(o.paidAmount)} · менеджер сейчас: ${fromName}`);
  console.log(`Станет: ${to.name} (${to.role})`);
  if (o.managerEmail.toLowerCase() === to.email.toLowerCase()) return console.log("Уже на нём — ничего не меняю.");
  if (!process.argv.includes("--yes")) return console.log("Только показ. Выполнить: --yes");
  const ok = await updateWhere(SHEET_TABS.ORDERS, (r) => r.OrderID === o.orderId, () => ({ ManagerEmail: to.email }));
  if (!ok) throw new Error("строка заявки не найдена при записи");
  await logMoney({
    actorEmail: OWNER,
    orderId: o.orderId,
    action: MONEY_LOG_ACTIONS.ORDER_EDITED,
    details: `Менеджер заявки: ${fromName} → ${to.name}.${spec.reason ? ` ${spec.reason}` : ""}`,
    amountBefore: o.totalAmount,
    amountAfter: o.totalAmount,
  });
  console.log(`Готово: заявка №${code} теперь на ${to.name}.`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
