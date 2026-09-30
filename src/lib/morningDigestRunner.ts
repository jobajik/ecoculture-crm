import { FLOWER_TYPES, ROLES, SHEET_TABS } from "./constants";

const FLOWER_ORDER: string[] = [FLOWER_TYPES.ROSE, FLOWER_TYPES.EUSTOMA, FLOWER_TYPES.CHRYSANTHEMUM];
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
import { DIGEST_SETTING, digestParts, digestPhones } from "./morningDigest";

const SITE = () => (process.env.NEXTAUTH_URL || "https://www.crm-ecoculture.kz").replace(/\/+$/, "");

/** Сводка на сегодня из живой базы (два сообщения) — одним чтением (грабли 1.17). */
export async function buildMorningDigestParts(now: Date = new Date()): Promise<string[]> {
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
  const infos = inStock.map((b) => computeBatchStorageInfo(b, settings, now));
  const expiredStems = infos.filter((i) => i.status === "critical").reduce((s, i) => s + i.batch.quantityRemaining, 0);
  // Склад по цветкам: всего и сколько из этого дольше срока хранения.
  const stockMap = new Map<string, { flowerType: string; stems: number; expired: number }>();
  for (const i of infos) {
    const row = stockMap.get(i.batch.flowerType) ?? { flowerType: i.batch.flowerType, stems: 0, expired: 0 };
    row.stems += i.batch.quantityRemaining;
    if (i.status === "critical") row.expired += i.batch.quantityRemaining;
    stockMap.set(i.batch.flowerType, row);
  }
  const stock = FLOWER_ORDER.map((t) => stockMap.get(t)).filter((x): x is NonNullable<typeof x> => !!x);
  const focus = homeFocus({
    role: ROLES.ADMIN,
    email: "",
    orders,
    todayKey: today,
    extras: { expiredStems, stockStems: inStock.reduce((s, b) => s + b.quantityRemaining, 0) },
  });
  return digestParts({
    today,
    orders,
    payments,
    pointDays,
    attention: focus?.attention ?? [],
    names: nameIndex(users),
    stock,
    dayOf: (iso) => localDayKey(new Date(iso)),
    site: SITE(),
  });
}

/** Вся сводка одним текстом — для предпросмотра («Как выглядит», diag-digest). */
export async function buildMorningDigest(now: Date = new Date()): Promise<string> {
  return (await buildMorningDigestParts(now)).join("\n\n— — —\n\n");
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

  const parts = await buildMorningDigestParts();
  const sent: string[] = [];
  const failed: string[] = [];
  for (const p of phones) {
    try {
      // Сообщения по порядку: второе уходит только после первого.
      for (const part of parts) await sendText(channel.cfg, p, part, { linkPreview: false });
      sent.push(p);
    } catch (err) {
      console.error("digest send:", err instanceof Error ? err.message : err);
      failed.push(p);
    }
  }
  return { sent, failed, note: failed.length ? "не на все номера ушло" : "" };
}
