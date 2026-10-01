import { FLOWER_TYPE_LABELS, compareGrades, formatGrade } from "./constants";
import { computeBatchStorageInfo } from "./shelfLife";
import { phoneKey } from "./leads";
import type { Batch, Settings } from "./types";

// ---------------------------------------------------------------------------
// Что бот знает сам, без менеджера (владелец, 01.10.2026: «нужен бот по
// последней рассылке, который будет сам отвечать»). Первая неделя показала:
// бот передавал менеджеру вопросы «что есть в наличии», «пришлите каталог»,
// «есть скидки?» и молчал сутки, а менеджер не отвечал. Теперь у него есть
// живой склад и текст последней рассылки. Чистые функции — проверка в
// `check-broadcasts`.
// ---------------------------------------------------------------------------

const FLOWER_ORDER = ["rose", "chrysanthemum", "eustoma"];

/** Сколько стеблей сказать модели: вниз до сотен, меньше сотни — «мало». */
export function roughStems(n: number): string {
  if (n < 100) return "мало, до 100 шт.";
  const r = n >= 1000 ? Math.floor(n / 500) * 500 : Math.floor(n / 100) * 100;
  return `около ${r.toLocaleString("ru-RU").replace(/\s/g, " ")} шт.`;
}

/**
 * Что сейчас можно продать: остаток партий без просроченных (`critical` —
 * дольше срока хранения, клиенту его не предлагают), сложенный по цветку,
 * сорту и длине/категории. Ключ — «цветок|сорт|градация».
 */
export function stockMap(
  batches: Batch[],
  settings: Settings,
  now: Date
): Map<string, { flower: string; variety: string; grade: string; qty: number }> {
  const sums = new Map<string, { flower: string; variety: string; grade: string; qty: number }>();
  for (const b of batches) {
    if (!(b.quantityRemaining > 0)) continue;
    const info = computeBatchStorageInfo(b, settings, now);
    if (info.status === "critical" || info.status === "depleted") continue;
    const key = `${b.flowerType}|${b.variety}|${b.grade}`;
    const cur = sums.get(key) ?? { flower: b.flowerType, variety: b.variety || "", grade: b.grade, qty: 0 };
    cur.qty += b.quantityRemaining;
    sums.set(key, cur);
  }
  return sums;
}

/** Склад для подсказки модели: строка на позицию, количество округлено вниз. */
export function stockForBot(batches: Batch[], settings: Settings, now: Date): string {
  const sums = stockMap(batches, settings, now);
  const fi = (f: string) => {
    const i = FLOWER_ORDER.indexOf(f);
    return i < 0 ? 99 : i;
  };
  const rows = Array.from(sums.values())
    .filter((r) => r.qty > 0)
    .sort((a, b) => fi(a.flower) - fi(b.flower) || a.variety.localeCompare(b.variety, "ru") || compareGrades(a.flower, a.grade, b.grade));
  const text = rows
    .map((r) => `${FLOWER_TYPE_LABELS[r.flower] ?? r.flower} · ${r.variety || "без сорта"} · ${formatGrade(r.grade)} — ${roughStems(r.qty)}`)
    .join("\n");
  return text.length > 6000 ? `${text.slice(0, 6000)}\n…` : text;
}

type BroadcastLite = { broadcastId?: string; title: string; text: string; startedAt: string; createdAt: string };
type RecipientLite = { broadcastId: string; phone: string; status: string; sentAt: string };

/**
 * О чём мы написали этому клиенту: последняя рассылка, которая ему УШЛА. Номер
 * неизвестен или в получателях его нет — последняя рассылка, ушедшая хотя бы
 * трём людям (проверочная на свой номер не в счёт), иначе просто последняя.
 * Первая версия брала последнюю по дате запуска — и бот читал «Тестовую».
 */
export function lastBroadcastForBot(list: BroadcastLite[], recipients: RecipientLite[] = [], phone = ""): string {
  const started = list.filter((b) => b.startedAt && b.text.trim());
  if (started.length === 0) return "";
  const latest = (xs: BroadcastLite[]) => xs.reduce((a, b) => (b.startedAt > a.startedAt ? b : a));
  const sent = recipients.filter((r) => r.status === "sent");
  const key = phoneKey(phone);
  let chosen: BroadcastLite | null = null;
  if (key) {
    const mine = sent.filter((r) => phoneKey(r.phone) === key).sort((a, b) => (a.sentAt < b.sentAt ? 1 : -1));
    for (const r of mine) {
      chosen = started.find((b) => b.broadcastId === r.broadcastId) ?? null;
      if (chosen) break;
    }
  }
  if (!chosen) {
    const counts = new Map<string, number>();
    for (const r of sent) counts.set(r.broadcastId, (counts.get(r.broadcastId) ?? 0) + 1);
    const real = started.filter((b) => (counts.get(b.broadcastId ?? "") ?? 0) >= 3);
    chosen = latest(real.length > 0 ? real : started);
  }
  const text = chosen.text.replace(/\{\s*имя\s*\}/gi, "").replace(/[ \t]+\n/g, "\n").trim();
  return `«${chosen.title}», отправлена ${chosen.startedAt.slice(0, 10)}:\n${text.slice(0, 2500)}`;
}

const nf = (n: number) => Math.round(n).toLocaleString("ru-RU").replace(/\s/g, " ");

/**
 * Прайс для бота — уже РАЗРЕШЁННЫЙ: у каждого сорта цена по каждой категории
 * (своя или «все сорта»), сорта с одинаковыми ценами — одной строкой. Раньше
 * модели давали сырые строки «сорт · категория — цена» вместе со строками «все
 * сорта», и она путала: на заказ «Алтай 3 категория» назвала цену второй, а
 * Алтай высшую — по общей цене, хотя у Алтая своя.
 */
export function pricesForBot(rows: { flowerType: string; variety: string; grade: string; price: number }[]): string {
  const lines: string[] = [];
  const flowers = Array.from(new Set(rows.filter((r) => r.price > 0).map((r) => r.flowerType))).sort((a, b) => {
    const ia = FLOWER_ORDER.indexOf(a);
    const ib = FLOWER_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  for (const f of flowers) {
    const own = rows.filter((r) => r.flowerType === f && r.price > 0);
    const base = new Map(own.filter((r) => !r.variety).map((r) => [r.grade, r.price]));
    const grades = Array.from(new Set(own.map((r) => r.grade))).sort((a, b) => compareGrades(f, a, b));
    const varieties = Array.from(new Set(own.filter((r) => r.variety).map((r) => r.variety))).sort((a, b) => a.localeCompare(b, "ru"));
    const priceOf = (v: string, g: string) => own.find((r) => r.variety === v && r.grade === g)?.price ?? base.get(g) ?? 0;
    const groups = new Map<string, string[]>();
    for (const v of [...varieties, ""]) {
      if (!v && base.size === 0) continue;
      const parts = grades.map((g) => {
        const p = priceOf(v, g);
        return p > 0 ? `${formatGrade(g)} ${nf(p)}` : "";
      });
      const key = parts.filter(Boolean).join(" · ");
      if (!key) continue;
      groups.set(key, [...(groups.get(key) ?? []), v]);
    }
    const name = FLOWER_TYPE_LABELS[f] ?? f;
    for (const [key, vs] of groups) {
      const names = vs.map((v) => v || "остальные сорта").join(", ");
      lines.push(`${name} ${names}: ${key} ₸`);
    }
  }
  return lines.join("\n");
}
