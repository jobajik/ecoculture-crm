import { greenConfig, sendText } from "./greenApi";
import { waPhone } from "./broadcast";
import { listUsers } from "./repo/users";
import { managerProfiles } from "./repo/regionStore";
import { FLOWER_TYPE_LABELS, getFarmFor } from "./constants";
import { regionSeat } from "./regionTruck";
import { storeInto, type StoreCode } from "./officeStore";

/**
 * Служебные сообщения о фурах в WhatsApp — своим сотрудникам, с основного номера (22.11.2026, владелец: «форму заполнить
 * и отправить зав. складам»). Заказ города и так лежит на экране «Фуры в регионы», сообщение — чтобы склад узнал о нём
 * сразу, а менеджер города — что фура загружена и чего в ней не будет. Номер — из карточки сотрудника («WhatsApp» в
 * «Настройках»); нет номера или основной номер не подключён — молча ничего: работа от сообщения не зависит.
 */
async function sendTo(phones: string[], text: string): Promise<number> {
  const cfg = greenConfig();
  if (!cfg || !text) return 0;
  let sent = 0;
  for (const phone of Array.from(new Set(phones.map((p) => waPhone(p)).filter(Boolean)))) {
    try {
      await sendText(cfg, phone, text, { linkPreview: false });
      sent += 1;
    } catch (err) {
      console.error("truck notify:", err instanceof Error ? err.message : err);
    }
  }
  return sent;
}

const nf = (n: number) => n.toLocaleString("ru-RU").replace(/ | /g, " ");
const day = (key: string) => `${key.slice(8, 10)}.${key.slice(5, 7)}`;

/** Склад: город подал заказ на фуру. Каждому зав. складом — только про цветок его производства. */
export async function notifyWarehouseOfTruckOrder(input: { city: string; day: string; byName: string; items: { flowerType: string; quantity: number }[]; origin: string }): Promise<number> {
  try {
    const users = (await listUsers()).filter((u) => u.active && u.role === "warehouse" && u.phone);
    let sent = 0;
    for (const u of users) {
      const own = input.items.filter((i) => !u.farm || getFarmFor(i.flowerType) === u.farm);
      const total = own.reduce((s, i) => s + i.quantity, 0);
      if (total <= 0) continue;
      const byFlower = new Map<string, number>();
      for (const i of own) byFlower.set(i.flowerType, (byFlower.get(i.flowerType) ?? 0) + i.quantity);
      const parts = Array.from(byFlower.entries()).map(([f, q]) => `${(FLOWER_TYPE_LABELS[f] ?? f).toLowerCase()} ${nf(q)}`);
      const text = `Заказ на фуру: ${input.city}, ${day(input.day)} - ${nf(total)} шт. (${parts.join(", ")}).${input.byName ? ` Заказал: ${input.byName}.` : ""}\nОткрыть и загрузить: ${input.origin}/warehouse/trucks`;
      sent += await sendTo([u.phone], text);
    }
    return sent;
  } catch (err) {
    console.error("truck notify:", err instanceof Error ? err.message : err);
    return 0;
  }
}

/** Менеджерам города: склад загрузил фуру — сколько едет и чего не будет. */
export async function notifyCityOfTruckLoad(input: { store: StoreCode; city: string; day: string; total: number; missing: { name: string; quantity: number; note: string }[]; added: number; origin: string }): Promise<number> {
  try {
    const seat = regionSeat(await managerProfiles(), input.store);
    const emails = new Set([...seat.directors, ...seat.managers].map((e) => e.toLowerCase()));
    const phones = (await listUsers()).filter((u) => u.active && emails.has(u.email.toLowerCase()) && u.phone).map((u) => u.phone);
    if (phones.length === 0) return 0;
    const lines = [`Склад загрузил фуру в ${storeInto(input.store)} (${day(input.day)}): едет ${nf(input.total)} шт.${input.added > 0 ? ` Из них ${nf(input.added)} шт. склад добавил сам.` : ""}`];
    if (input.missing.length > 0) {
      lines.push("Не будет:");
      for (const m of input.missing.slice(0, 12)) lines.push(`- ${m.name}: ${nf(m.quantity)} шт. (${m.note})`);
      if (input.missing.length > 12) lines.push(`- и ещё позиций: ${input.missing.length - 12}`);
    }
    lines.push(`Когда фура придёт, подтвердите приёмку: ${input.origin}/region/${input.store}/truck`);
    return sendTo(phones, lines.join("\n"));
  } catch (err) {
    console.error("truck notify:", err instanceof Error ? err.message : err);
    return 0;
  }
}
