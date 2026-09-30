import { ROLES, SHEET_TABS } from "./constants";
import { prefetchTables } from "./sheets";
import { localDayKey } from "./timezone";
import { listOrdersWithItems } from "./repo/orders";
import { listPayments } from "./repo/payments";
import { listPointDays } from "./repo/point";
import { listBatches } from "./repo/batches";
import { getSettings } from "./repo/settings";
import { settingsMap } from "./repo/broadcasts";
import { listUsers } from "./repo/users";
import { computeBatchStorageInfo } from "./shelfLife";
import { homeFocus } from "./homeFocus";
import { nameIndex } from "./personName";
import { waPhone } from "./broadcast";
import { sendText } from "./greenApi";
import { checkGreenChannel } from "./greenChannel";
import { DIGEST_SETTING, digestPhones, digestText } from "./morningDigest";

const SITE = () => (process.env.NEXTAUTH_URL || "https://www.crm-ecoculture.kz").replace(/\/+$/, "");

/** Собрать текст сводки на сегодня из живой базы — одним чтением (грабли 1.17). */
export async function buildMorningDigest(now: Date = new Date()): Promise<string> {
  await prefetchTables([
    SHEET_TABS.ORDERS,
    SHEET_TABS.ORDER_ITEMS,
    SHEET_TABS.CLIENTS,
    SHEET_TABS.PAYMENTS,
    SHEET_TABS.POINT_SALES,
    SHEET_TABS.BATCHES,
    SHEET_TABS.SETTINGS,
    SHEET_TABS.USERS,
  ]);
  const [orders, payments, pointDays, batches, settings, users] = await Promise.all([
    listOrdersWithItems(),
    listPayments(),
    listPointDays(),
    listBatches(),
    getSettings(),
    listUsers(),
  ]);
  const today = localDayKey(now);
  const inStock = batches.filter((b) => b.quantityRemaining > 0);
  const expiredStems = inStock
    .map((b) => computeBatchStorageInfo(b, settings, now))
    .filter((i) => i.status === "critical")
    .reduce((s, i) => s + i.batch.quantityRemaining, 0);
  const focus = homeFocus({
    role: ROLES.ADMIN,
    email: "",
    orders,
    todayKey: today,
    extras: { expiredStems, stockStems: inStock.reduce((s, b) => s + b.quantityRemaining, 0) },
  });
  return digestText({
    today,
    orders,
    payments,
    pointDays,
    attention: focus?.attention ?? [],
    names: nameIndex(users),
    dayOf: (iso) => localDayKey(new Date(iso)),
    site: SITE(),
  });
}

/**
 * Отправить сводку на номера из настройки. Разовый сбой Green API —
 * одна повторная попытка через 20 секунд (функция живёт минуту).
 */
export async function sendMorningDigest(phonesOverride?: string[]): Promise<{ sent: string[]; failed: string[]; note: string }> {
  const raw = phonesOverride ?? digestPhones((await settingsMap(true))[DIGEST_SETTING]);
  const phones = raw.map(waPhone).filter(Boolean);
  if (phones.length === 0) return { sent: [], failed: [], note: "номера для сводки не указаны" };

  let channel = await checkGreenChannel();
  if (channel.action === "retry") {
    await new Promise((r) => setTimeout(r, 20_000));
    channel = await checkGreenChannel();
  }
  if (channel.action !== "ok" || !channel.cfg) return { sent: [], failed: phones, note: channel.text };

  const text = await buildMorningDigest();
  const sent: string[] = [];
  const failed: string[] = [];
  for (const p of phones) {
    try {
      await sendText(channel.cfg, p, text);
      sent.push(p);
    } catch (err) {
      console.error("digest send:", err instanceof Error ? err.message : err);
      failed.push(p);
    }
  }
  return { sent, failed, note: failed.length ? "не на все номера ушло" : "" };
}
