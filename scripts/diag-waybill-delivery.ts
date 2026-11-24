import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

/**
 * Накладные клиентам: дошли ли они на самом деле (24.11.2026, владелец: «почему ты реально не отправляешь накладные
 * клиентам, которые купили?»). Только чтение. «Отправлено» в таблице значит лишь, что Green API принял сообщение; если
 * номер, через который оно ушло, отключён от WhatsApp, оно лежит в очереди и клиенту не приходит.
 *
 * По каждому номеру отправки: что с ним сейчас у Green API, сколько накладных через него ушло, у скольких есть отметка
 * «доставлено / прочитано», у скольких нет никакой. Ниже — накладные без отметки о доставке и не отправленные вовсе,
 * с причиной. Номера клиентов — последние 4 цифры.
 *
 *   npx tsx scripts/diag-waybill-delivery.ts [дней=6]
 */
import { listOrdersWithItems } from "../src/lib/repo/orders";
import { listWaybills } from "../src/lib/repo/waybills";
import { listWaStatuses } from "../src/lib/repo/broadcasts";
import { lineConfig, listWaLines } from "../src/lib/repo/waLines";
import { listUsers } from "../src/lib/repo/users";
import { deliveryByMessage } from "../src/lib/broadcast";
import { GreenError, getInstanceState } from "../src/lib/greenApi";
import { lineHealth } from "../src/lib/waybill";
import { orderCode } from "../src/lib/paymentStage";

const almaty = (iso: string) => new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Almaty", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

async function main() {
  const days = Math.max(1, Number(process.argv[2]) || 6);
  const from = Date.now() - days * 86400000;
  const [waybills, statuses, lines, users, orders] = await Promise.all([listWaybills({ fresh: true }), listWaStatuses(), listWaLines({ fresh: true }), listUsers(), listOrdersWithItems()]);
  const delivery = deliveryByMessage(statuses);
  const orderById = new Map(orders.map((o) => [o.orderId, o]));
  const nameOf = (email: string) => (users.find((u) => u.email.toLowerCase() === email.toLowerCase())?.name || "").split(/\s+/)[0] || "?";
  const lineName = (code: string) => (!code || code === "main" ? "основной номер" : code === "leads" ? "номер Земфиры" : `номер: ${nameOf(lines.find((l) => l.code === code)?.managerEmail || "")}`);
  const recent = waybills.filter((w) => Date.parse(w.createdAt) >= from);
  const sent = recent.filter((w) => w.status === "sent");

  console.log(`Накладных за ${days} дн.: ${recent.length}; отмечены «отправлено»: ${sent.length}`);
  const codes = Array.from(new Set(["main", ...sent.map((w) => w.line || "main"), ...lines.map((l) => l.code)]));
  const health = new Map<string, string>();
  for (const code of codes) {
    let text = "";
    try {
      const cfg = await lineConfig(code === "main" ? "" : code);
      if (!cfg) text = "ОТКЛЮЧЁН (нет ключей или номер выключен)";
      else {
        try {
          const state = await getInstanceState(cfg);
          text = lineHealth({ hasKeys: true, state }) === "ok" ? "подключён" : `НЕ ПОДКЛЮЧЁН К WHATSAPP (${state})`;
        } catch (err) {
          const st = err instanceof GreenError ? err.status : 0;
          text = lineHealth({ hasKeys: true, errorStatus: st }) === "down" ? `ОТКЛЮЧЁН (${err instanceof Error ? err.message.slice(0, 90) : st})` : `не ответил (${st})`;
        }
      }
    } catch {
      text = "не удалось проверить";
    }
    health.set(code, text);
    const own = sent.filter((w) => (w.line || "main") === code);
    const got = own.filter((w) => ["delivered", "read"].includes(delivery.get(w.messageId)?.status ?? ""));
    const left = own.filter((w) => delivery.get(w.messageId)?.status === "sent");
    const none = own.filter((w) => !delivery.get(w.messageId) || delivery.get(w.messageId)?.status === "error");
    console.log(`\n${lineName(code)} — сейчас: ${text}`);
    console.log(`  накладных через него: ${own.length} · доставлено или прочитано: ${got.length} · ушло, отметки о доставке нет: ${left.length} · НИКАКОЙ ОТМЕТКИ: ${none.length}`);
  }

  const lost = sent.filter((w) => !delivery.get(w.messageId) || delivery.get(w.messageId)?.status === "error").sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  console.log(`\nОтмечены «отправлено», но отметки о доставке нет вовсе: ${lost.length}`);
  for (const w of lost) {
    const o = orderById.get(w.orderId);
    console.log(`  ${almaty(w.createdAt)} № ${w.number} · ${o?.clientName || "?"} · …${w.phone.slice(-4)} · ${lineName(w.line)} (${health.get(w.line || "main")}) · менеджер заявки: ${nameOf(o?.managerEmail || "")}${w.note ? ` · ${w.note}` : ""}`);
  }
  const not = recent.filter((w) => w.status === "skipped" || w.status === "failed" || w.status === "sending").sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  console.log(`\nНе отправлены: ${not.length}`);
  for (const w of not) {
    const o = orderById.get(w.orderId);
    console.log(`  ${almaty(w.createdAt)} № ${w.number} · ${o?.clientName || "?"} · ${w.status} · ${w.note || "без причины"} · менеджер заявки: ${nameOf(o?.managerEmail || "")} · ${w.byEmail === "auto" ? "автомат" : "кнопкой"}`);
  }
  // Не ушла ли одна накладная клиенту дважды: в переписке каждая отправка — своя запись «[накладная № …]».
  if (process.argv.includes("--dups")) {
    const { listWaMessages } = await import("../src/lib/repo/talks");
    const msgs = (await listWaMessages({ lines: "all" })).filter((m) => m.direction === "out" && m.text.startsWith("[накладная № ") && Date.parse(m.at) >= from);
    const byNumber = new Map<string, typeof msgs>();
    for (const m of msgs) {
      const n = /^\[накладная № ([^\]]+)\]/.exec(m.text)?.[1] ?? "";
      byNumber.set(n, [...(byNumber.get(n) ?? []), m]);
    }
    const twice = Array.from(byNumber.entries()).filter(([, list]) => list.length > 1);
    console.log(`\nЗаписей об отправке накладных в переписке: ${msgs.length}; накладных, ушедших больше одного раза: ${twice.length}`);
    for (const [n, list] of twice) console.log(`  № ${n}: ${list.map((m) => `${almaty(m.at)} ${lineName(m.line || "main")}`).join(" → ")}`);
  }
  const reasons = new Map<string, number>();
  for (const w of not) reasons.set(w.note.split(" — ")[0] || w.status, (reasons.get(w.note.split(" — ")[0] || w.status) ?? 0) + 1);
  console.log(`\nПричины: ${Array.from(reasons.entries()).map(([k, n]) => `${k}: ${n}`).join("; ") || "нет"}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
