import { FLOWER_ORDER_ALL, FLOWER_TYPE_LABELS_PLURAL, ORDER_STATUSES, SHIPMENT_DIRECTIONS, weeksOfMonth } from "./constants";
import { channelOf, daysInMonth, shiftMonth, MONTH_NAMES, type Channel } from "./monthReport";
import { cleanDirection } from "./direction";
import { BOT_MANAGER_EMAIL } from "./botIdentity";
import type { Batch, OrderWithItems, Writeoff } from "./types";

// ---------------------------------------------------------------------------
// «План с ИИ» (11.11.2026, владелец: «сделай возможность распределить план продаж по менеджерам, регионам и другим
// каналам через ИИ — сам ИИ советует, как и сколько распределить на основании истории продаж, стока, будущих срезов
// и прочего; вкладка у меня и Данияра»). Здесь — ЧИСТЫЙ расчёт без модели: сколько цветка будет (склад + срезка −
// списания), сколько обычно продаём (история по дням с весами), сколько ставить в план по сценарию и как разложить по
// каналам, менеджерам и направлениям. Модель (`aiPlanAdvisor.ts`) цифр не считает — она двигает доли множителями и
// объясняет; арифметику сводит этот модуль (`advice` в `buildAiPlan`), как и везде, где ИИ что-то предлагает
// (грабли 1.11). Страница — `/plans/ai`, проверка — `check-ai-plan`.
// ---------------------------------------------------------------------------

export type Scenario = "careful" | "base" | "ambitious";
export const SCENARIOS: { code: Scenario; label: string; hint: string }[] = [
  { code: "careful", label: "Осторожный", hint: "продаём в день, как в прошлом полном месяце (если сейчас идём быстрее)" },
  { code: "base", label: "Базовый", hint: "продаём в день, как идём сейчас, с учётом последних месяцев" },
  { code: "ambitious", label: "Амбициозный", hint: "на 20% быстрее, чем идём сейчас, если цветка хватает" },
];
/**
 * Насколько план выше «темпа продаж» (дневной темп с весами по истории). Ставить в план весь лишний цветок нельзя: в
 * первой версии «базовый» брал половину излишка, и при большой срезке планы менеджеров выходили вчетверо выше их
 * истории — такой план не выполняют и не читают. Излишек остаётся отдельной цифрой («останется»): это вопрос нового
 * канала, а не плана людям. На живых данных 11.11.2026 первая декада ноября шла на 78 % быстрее октября (две крупные
 * заявки) — поэтому «осторожный» не верит всплеску и берёт темп прошлого ПОЛНОГО месяца, если он ниже.
 */
export const SCENARIO_STRETCH: Record<Scenario, number> = { careful: 1, base: 1, ambitious: 1.2 };
export const cleanScenario = (raw: unknown): Scenario => (raw === "careful" || raw === "ambitious" ? raw : "base");

export const PLAN_CHANNELS: Channel[] = ["clients", "region", "shops", "point"];
export const PLAN_CHANNEL_LABELS: Record<Channel, string> = {
  clients: "Клиенты менеджеров",
  region: "Объём в регионы",
  shops: "Наши магазины",
  point: "Точка на базаре",
};

/** Границы множителя ИИ: сильнее двигать долю он не может — это уже другое решение, его принимает человек. */
export const FACTOR_MIN = 0.6;
export const FACTOR_MAX = 1.5;
export const clampFactor = (n: unknown): number => {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? Math.min(FACTOR_MAX, Math.max(FACTOR_MIN, v)) : 1;
};

export interface Qty {
  stems: number;
  sum: number;
}
const q0 = (): Qty => ({ stems: 0, sum: 0 });
const add = (a: Qty, stems: number, sum: number) => {
  a.stems += stems;
  a.sum += sum;
};

export interface PlanPeriod {
  /** Неполный период — текущий месяц по вчера. */
  partial?: boolean;
  label: string;
  from: string;
  to: string;
  days: number;
  weight: number;
}

export interface FlowerSupply {
  flowerType: string;
  stock: number;
  forecastLeft: number;
  /** Откуда взята срезка: прогноз агронома, средняя за 4 недели или нет ничего. */
  forecastSource: "agronomist" | "average" | "none";
  writeoffShare: number;
  /** Сколько можно продать за оставшиеся дни: склад + срезка − ожидаемые списания. */
  sellable: number;
  /** Сколько продадим за столько дней по темпу продаж (дневной темп с весами по истории, все каналы). */
  demandLeft: number;
  fact: Qty;
  targetLeft: number;
  targetMonth: number;
  /** Положительное — останется лишним, отрицательное — не хватит до обычных продаж. */
  gap: number;
  price: number;
}

export interface ChannelPlan {
  channel: Channel;
  label: string;
  /** Стебли по периодам истории (в том же порядке, что `periods`). */
  history: number[];
  fact: Qty;
  byFlower: Record<string, Qty>;
  target: Qty;
  reason: string;
}

export interface ManagerPlan {
  email: string;
  name: string;
  /** Выручка по периодам истории. */
  history: number[];
  fact: Qty;
  /** Уже продано в этом месяце по цветкам — из него и остатка складывается план месяца. */
  factByFlower: Record<string, Qty>;
  byFlower: Record<string, Qty>;
  /** План на оставшиеся дни. */
  target: Qty;
  /** План на месяц целиком: уже сделано + остаток. */
  month: Qty;
  share: number;
  perDay: number;
  clients: number;
  /** Что сейчас записано в «Планах продаж» на этот месяц. */
  current: number;
  isNew: boolean;
  /** Строка бота: показывается, но в «Планы продаж» не пишется. */
  virtual: boolean;
  reason: string;
}

export interface DirectionPlan {
  direction: string;
  history: number[];
  fact: number;
  byFlower: Record<string, Qty>;
  target: Qty;
  reason: string;
}

export interface AiPlan {
  month: string;
  today: string;
  scenario: Scenario;
  isCurrent: boolean;
  from: string;
  to: string;
  daysLeft: number;
  daysTotal: number;
  periods: PlanPeriod[];
  flowers: FlowerSupply[];
  channels: ChannelPlan[];
  managers: ManagerPlan[];
  directions: DirectionPlan[];
  /** Клиентский канал целиком: уже сделано и план на месяц. */
  clientsFact: number;
  clientsMonth: number;
  /** Клиентские продажи тех, кто не числится менеджером (ушёл или другая роль): их доля роздана менеджерам. */
  departed: { name: string; sum: number }[];
  notes: string[];
}

export interface AiAdvice {
  summary: string;
  managers: { email: string; factor: number; reason: string }[];
  channels: { channel: string; factor: number; reason: string }[];
  directions: { direction: string; factor: number; reason: string }[];
  risks: string[];
  actions: string[];
}

export interface AiPlanInput {
  month: string;
  today: string;
  scenario: Scenario;
  orders: OrderWithItems[];
  batches: Batch[];
  writeoffs: Writeoff[];
  /** Действующие менеджеры (роль manager, активные). */
  managers: { email: string; name: string }[];
  names: Record<string, string>;
  /** Прогноз срезки агронома: [цветок][код недели] — стебли. */
  forecast: Record<string, Record<string, number>>;
  /** Сколько активных клиентов на менеджере. */
  clientCount: Record<string, number>;
  /** Действующий план месяца по менеджерам, ₸. */
  currentPlans: Record<string, number>;
  advice?: AiAdvice | null;
}

const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const ms = (day: string) => Date.parse(`${day}T00:00:00Z`);
export const shiftDay = (day: string, by: number) => iso(ms(day) + by * DAY);
const daysBetween = (from: string, to: string) => Math.max(0, Math.round((ms(to) - ms(from)) / DAY) + 1);
const dayOf = (v: string | null | undefined) => String(v || "").slice(0, 10);
const monthEnd = (ym: string) => `${ym}-${String(daysInMonth(ym)).padStart(2, "0")}`;
const overlap = (aFrom: string, aTo: string, bFrom: string, bTo: string) => {
  const from = aFrom > bFrom ? aFrom : bFrom;
  const to = aTo < bTo ? aTo : bTo;
  return from > to ? 0 : daysBetween(from, to);
};

/** На какие месяцы можно ставить план: текущий и следующий. */
export function planMonths(today: string): string[] {
  const now = today.slice(0, 7);
  return [now, shiftMonth(now, 1)];
}
export function cleanPlanMonth(raw: unknown, today: string): string {
  const list = planMonths(today);
  return list.includes(String(raw)) ? String(raw) : list[0];
}

/** Периоды истории, свежие первыми: текущий месяц по вчера (если прошло от 8 дней) и до трёх полных месяцев. */
export function historyPeriods(month: string, today: string): PlanPeriod[] {
  const nowMonth = today.slice(0, 7);
  const out: PlanPeriod[] = [];
  const yesterday = shiftDay(today, -1);
  const elapsed = Number(today.slice(8, 10)) - 1;
  if (elapsed >= 7) {
    out.push({ partial: true, label: `${MONTH_NAMES[Number(nowMonth.slice(5, 7)) - 1]}, 1–${elapsed}`, from: `${nowMonth}-01`, to: yesterday, days: elapsed, weight: 0 });
  }
  for (let i = 1; i <= 3; i++) {
    const m = shiftMonth(nowMonth, -i);
    out.push({ label: MONTH_NAMES[Number(m.slice(5, 7)) - 1], from: `${m}-01`, to: monthEnd(m), days: daysInMonth(m), weight: 0 });
  }
  return month >= nowMonth ? out : [];
}

const WEIGHTS = [0.5, 0.3, 0.2];

/** Обычная заявка считается по дню оформления (кто продал в месяце), остальные каналы — по дню доставки. */
function saleDay(o: OrderWithItems, channel: Channel): string {
  return channel === "clients" ? dayOf(o.createdAt) : dayOf(o.deliveryDate) || dayOf(o.createdAt);
}

interface Slice {
  channel: Record<string, Record<string, Qty>>;
  manager: Record<string, Record<string, Qty>>;
  direction: Record<string, Record<string, Qty>>;
}
const emptySlice = (): Slice => ({ channel: {}, manager: {}, direction: {} });
const cell = (root: Record<string, Record<string, Qty>>, a: string, b: string): Qty => ((root[a] ??= {})[b] ??= q0());

function collect(orders: OrderWithItems[], from: string, to: string): Slice {
  const s = emptySlice();
  for (const o of orders) {
    if (o.status === ORDER_STATUSES.CANCELLED) continue;
    const channel = channelOf(o);
    const day = saleDay(o, channel);
    const inWindow = day >= from && day <= to;
    const shipDay = dayOf(o.deliveryDate) || dayOf(o.createdAt);
    const direction = channel === "shops" ? "" : cleanDirection(o.direction);
    const dirIn = !!direction && SHIPMENT_DIRECTIONS.includes(direction) && shipDay >= from && shipDay <= to;
    if (!inWindow && !dirIn) continue;
    const email = String(o.managerEmail || "").trim().toLowerCase();
    for (const it of o.items) {
      const qty = Number(it.quantity) || 0;
      if (qty <= 0) continue;
      const sum = qty * (Number(it.unitPrice) || 0);
      if (inWindow) {
        add(cell(s.channel, channel, it.flowerType), qty, sum);
        if (channel === "clients") add(cell(s.manager, email, it.flowerType), qty, sum);
      }
      if (dirIn) add(cell(s.direction, direction, it.flowerType), qty, sum);
    }
  }
  return s;
}

const total = (row: Record<string, Qty> | undefined): Qty => {
  const t = q0();
  for (const v of Object.values(row ?? {})) add(t, v.stems, v.sum);
  return t;
};

/** Раскладывает целое по весам так, чтобы сумма сошлась стебель в стебель (наибольшие остатки). */
export function splitWhole(totalValue: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + Math.max(0, b), 0);
  const whole = Math.max(0, Math.round(totalValue));
  if (!weights.length) return [];
  if (sum <= 0) return weights.map(() => 0);
  const raw = weights.map((w) => (whole * Math.max(0, w)) / sum);
  const out = raw.map((r) => Math.floor(r));
  let left = whole - out.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, frac: r - Math.floor(r) })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const o of order) {
    if (left <= 0) break;
    out[o.i] += 1;
    left -= 1;
  }
  return out;
}

const median = (list: number[]) => {
  const s = list.filter((x) => x > 0).sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0;
};

const nf = (n: number) => Math.round(n).toLocaleString("ru-RU");

export function buildAiPlan(input: AiPlanInput): AiPlan {
  const { month, today, scenario } = input;
  const nowMonth = today.slice(0, 7);
  const isCurrent = month === nowMonth;
  const from = isCurrent ? today : `${month}-01`;
  const to = monthEnd(month);
  const daysLeft = daysBetween(from, to);
  const daysTotal = daysInMonth(month);
  const notes: string[] = [];

  // --- История: периоды с продажами, веса свежим больше ---
  const candidates = historyPeriods(month, today).map((p) => ({ p, s: collect(input.orders, p.from, p.to) }));
  const used = candidates.filter((c) => Object.values(c.s.channel).some((row) => total(row).stems > 0)).slice(0, 3);
  const wSum = used.reduce((a, _c, i) => a + WEIGHTS[i], 0) || 1;
  used.forEach((c, i) => (c.p.weight = WEIGHTS[i] / wSum));
  const periods = used.map((c) => c.p);
  if (!periods.length) notes.push("Истории продаж нет — план разложен только по наличию цветка.");
  /** Дневной темп с весами: Σ вес × (значение за период / дней периода). */
  const rate = (pick: (s: Slice) => number) => used.reduce((a, c) => a + c.p.weight * (pick(c.s) / c.p.days), 0);
  /** Темп прошлого ПОЛНОГО месяца — для осторожного сценария; полного месяца в истории нет — null. */
  const lastFull = used.find((c) => !c.p.partial) ?? null;

  const factSlice = isCurrent && today > `${month}-01` ? collect(input.orders, `${month}-01`, shiftDay(today, -1)) : emptySlice();

  // --- Сколько цветка будет ---
  const batchFlower = new Map(input.batches.map((b) => [b.batchId, b.flowerType]));
  const d28 = shiftDay(today, -28);
  const d30 = shiftDay(today, -30);
  const yesterday = shiftDay(today, -1);
  const weeks = weeksOfMonth(month);
  const k = scenario === "careful" ? 1 : scenario === "base" ? 0.8 : 0.6;

  const flowers: FlowerSupply[] = [];
  const targetLeftBy: Record<string, number> = {};
  const growth: Record<string, number> = {};
  for (const f of FLOWER_ORDER_ALL) {
    const stock = isCurrent ? input.batches.filter((b) => b.flowerType === f).reduce((a, b) => a + Math.max(0, b.quantityRemaining), 0) : 0;
    let forecastLeft = 0;
    for (const w of weeks) {
      const days = overlap(w.from, w.to, from, to);
      if (!days) continue;
      forecastLeft += ((input.forecast[f]?.[w.code] ?? 0) * days) / daysBetween(w.from, w.to);
    }
    let forecastSource: FlowerSupply["forecastSource"] = forecastLeft > 0 ? "agronomist" : "none";
    const cutOf = (since: string) =>
      input.batches
        .filter((b) => b.flowerType === f && !String(b.store || "").trim() && b.quantityIn > 0)
        .filter((b) => {
          const d = dayOf(b.harvestDate) || dayOf(b.receivedAt);
          return d >= since && d <= yesterday;
        })
        .reduce((a, b) => a + b.quantityIn, 0);
    if (forecastLeft <= 0) {
      const avg = (cutOf(d28) / 28) * daysLeft;
      if (avg > 0) {
        forecastLeft = avg;
        forecastSource = "average";
      }
    }
    const cut30 = cutOf(d30);
    const written30 = input.writeoffs.filter((w) => batchFlower.get(w.batchId) === f && dayOf(w.createdAt) >= d30).reduce((a, w) => a + w.quantity, 0);
    const writeoffShare = cut30 > 0 ? Math.min(0.6, written30 / cut30) : 0;
    const sellable = Math.round((stock + forecastLeft) * (1 - writeoffShare * k));
    const demandLeft = Math.round(rate((s) => PLAN_CHANNELS.reduce((a, ch) => a + (s.channel[ch]?.[f]?.stems ?? 0), 0)) * daysLeft);
    const fact = q0();
    for (const ch of PLAN_CHANNELS) add(fact, factSlice.channel[ch]?.[f]?.stems ?? 0, factSlice.channel[ch]?.[f]?.sum ?? 0);

    // Нет ни склада, ни срезки (прогноз не внесён и резали ноль) — ограничивать нечем: ставим обычные продажи.
    const knownSupply = stock + forecastLeft > 0;
    let targetLeft: number;
    if (!knownSupply) targetLeft = demandLeft;
    // История пуста (новый цветок) — мерить темп не от чего: в план идёт то, что можно продать.
    else if (demandLeft <= 0) targetLeft = sellable;
    else {
      let want = demandLeft * SCENARIO_STRETCH[scenario];
      if (scenario === "careful" && lastFull) {
        const calm = (PLAN_CHANNELS.reduce((a, ch) => a + (lastFull.s.channel[ch]?.[f]?.stems ?? 0), 0) / lastFull.p.days) * daysLeft;
        if (calm > 0) want = Math.min(want, calm);
      }
      targetLeft = Math.min(sellable, want);
    }
    targetLeft = Math.max(0, Math.round(targetLeft));

    const clientsHist = used.reduce((a, c) => { add(a, c.s.channel.clients?.[f]?.stems ?? 0, c.s.channel.clients?.[f]?.sum ?? 0); return a; }, q0());
    const price = clientsHist.stems > 0 ? clientsHist.sum / clientsHist.stems : 0;
    if (stock + forecastLeft + demandLeft + fact.stems === 0) continue;
    targetLeftBy[f] = targetLeft;
    growth[f] = demandLeft > 0 ? Math.min(2, Math.max(0.5, targetLeft / demandLeft)) : 1;
    flowers.push({
      flowerType: f,
      stock,
      forecastLeft: Math.round(forecastLeft),
      forecastSource,
      writeoffShare,
      sellable,
      demandLeft,
      fact,
      targetLeft,
      targetMonth: fact.stems + targetLeft,
      gap: knownSupply ? sellable - targetLeft : 0,
      price,
    });
    if (forecastSource === "average") notes.push(`${FLOWER_TYPE_LABELS_PLURAL[f] ?? f}: прогноза агронома на эти дни нет — срезка взята как средняя за 4 недели.`);
    if (forecastSource === "none" && demandLeft > 0) notes.push(`${FLOWER_TYPE_LABELS_PLURAL[f] ?? f}: нет ни прогноза срезки, ни приёмок за 4 недели — в плане обычные продажи, наличие не проверено.`);
  }
  const planFlowers = flowers.map((x) => x.flowerType);

  // --- Каналы: доля канала в цветке по темпу, множители ИИ, сумма по цветку сходится с планом цветка ---
  const chFactor = new Map((input.advice?.channels ?? []).map((c) => [c.channel, c]));
  const channels: ChannelPlan[] = PLAN_CHANNELS.map((channel) => ({
    channel,
    label: PLAN_CHANNEL_LABELS[channel],
    history: used.map((c) => total(c.s.channel[channel]).stems),
    fact: total(factSlice.channel[channel]),
    byFlower: {},
    target: q0(),
    reason: String(chFactor.get(channel)?.reason || ""),
  }));
  const channelPrice = (channel: Channel, f: string) => {
    const h = used.reduce((a, c) => { add(a, c.s.channel[channel]?.[f]?.stems ?? 0, c.s.channel[channel]?.[f]?.sum ?? 0); return a; }, q0());
    return h.stems > 0 ? h.sum / h.stems : 0;
  };
  for (const f of planFlowers) {
    const rates = PLAN_CHANNELS.map((ch) => rate((s) => s.channel[ch]?.[f]?.stems ?? 0));
    // Цветок без истории (новый товар) — весь в клиентский канал: больше продавать его некому.
    const base = rates.some((r) => r > 0) ? rates : PLAN_CHANNELS.map((ch) => (ch === "clients" ? 1 : 0));
    const weights = base.map((r, i) => r * clampFactor(chFactor.get(PLAN_CHANNELS[i])?.factor ?? 1));
    const parts = splitWhole(targetLeftBy[f], weights);
    parts.forEach((stems, i) => {
      const sum = Math.round(stems * channelPrice(PLAN_CHANNELS[i], f));
      channels[i].byFlower[f] = { stems, sum };
      add(channels[i].target, stems, sum);
    });
  }

  // --- Менеджеры: клиентский канал делится по темпу продаж каждого в этом цветке ---
  const mgrFactor = new Map((input.advice?.managers ?? []).map((m) => [String(m.email).toLowerCase(), m]));
  const active = input.managers.map((m) => ({ email: m.email.trim().toLowerCase(), name: m.name || input.names[m.email.trim().toLowerCase()] || m.email, virtual: false }));
  const botSold = used.some((c) => total(c.s.manager[BOT_MANAGER_EMAIL]).stems > 0);
  if (botSold && !active.some((m) => m.email === BOT_MANAGER_EMAIL)) active.push({ email: BOT_MANAGER_EMAIL, name: input.names[BOT_MANAGER_EMAIL] || "Бот WhatsApp", virtual: true });
  const histSum = (email: string) => used.map((c) => total(c.s.manager[email]).sum);
  const managers: ManagerPlan[] = active.map((m) => {
    const history = histSum(m.email);
    const fact = total(factSlice.manager[m.email]);
    return {
      email: m.email,
      name: m.name,
      history,
      fact,
      factByFlower: Object.fromEntries(Object.entries(factSlice.manager[m.email] ?? {}).map(([f, x]) => [f, { stems: x.stems, sum: Math.round(x.sum) }])),
      byFlower: {},
      target: q0(),
      month: q0(),
      share: 0,
      perDay: 0,
      clients: input.clientCount[m.email] ?? 0,
      current: input.currentPlans[m.email] ?? 0,
      isNew: !m.virtual && history.every((x) => x === 0) && fact.sum === 0,
      virtual: m.virtual,
      reason: String(mgrFactor.get(m.email)?.reason || ""),
    };
  });
  const clientsIdx = PLAN_CHANNELS.indexOf("clients");
  for (const f of planFlowers) {
    const rates = managers.map((m) => rate((s) => s.manager[m.email]?.[f]?.stems ?? 0));
    const positive = rates.filter((r) => r > 0);
    // Новый менеджер (ни одной продажи): ноль ему ставить нельзя, а равную долю — рано. Половина медианы, но не больше
    // трёх четвертей самого слабого из продающих.
    const starter = positive.length ? Math.min(median(rates) * 0.5, Math.min(...positive) * 0.75) : 0;
    const weights = managers.map((m, i) => (m.isNew ? starter : rates[i]) * clampFactor(mgrFactor.get(m.email)?.factor ?? 1));
    const usable = weights.some((w) => w > 0) ? weights : managers.map((m) => (m.virtual ? 0 : 1));
    const clientsTarget = channels[clientsIdx].byFlower[f]?.stems ?? 0;
    const parts = splitWhole(clientsTarget, usable);
    const company = flowers.find((x) => x.flowerType === f)?.price ?? 0;
    parts.forEach((stems, i) => {
      const own = used.reduce((a, c) => { add(a, c.s.manager[managers[i].email]?.[f]?.stems ?? 0, c.s.manager[managers[i].email]?.[f]?.sum ?? 0); return a; }, q0());
      const price = own.stems >= 100 ? own.sum / own.stems : company;
      const sum = Math.round(stems * price);
      managers[i].byFlower[f] = { stems, sum };
      add(managers[i].target, stems, sum);
    });
  }
  const mgrTotal = managers.reduce((a, m) => a + m.target.sum, 0);
  for (const m of managers) {
    m.month = { stems: m.fact.stems + m.target.stems, sum: m.fact.sum + m.target.sum };
    m.share = mgrTotal > 0 ? m.target.sum / mgrTotal : 0;
    m.perDay = daysLeft > 0 ? m.target.sum / daysLeft : 0;
    if (!m.reason && m.isNew) m.reason = "Новый менеджер: продаж ещё не было — план ниже самого слабого из продающих.";
  }
  managers.sort((a, b) => Number(a.virtual) - Number(b.virtual) || b.target.sum - a.target.sum);

  // Кто продавал клиентам, но менеджером не числится (ушёл или другая роль): доля роздана менеджерам — об этом надо сказать.
  const activeSet = new Set(active.map((m) => m.email));
  const departedMap = new Map<string, number>();
  for (const c of used) for (const [email, row] of Object.entries(c.s.manager)) if (!activeSet.has(email)) departedMap.set(email, (departedMap.get(email) ?? 0) + total(row).sum);
  const departed = [...departedMap.entries()].filter(([, sum]) => sum > 0).map(([email, sum]) => ({ name: input.names[email] || email || "без менеджера", sum })).sort((a, b) => b.sum - a.sum);
  if (departed.length) notes.push(`Клиентские продажи тех, кто не числится менеджером (${departed.map((d) => d.name).join(", ")} — ${nf(departed.reduce((a, d) => a + d.sum, 0))} ₸ за историю), розданы менеджерам по их долям.`);

  // --- Направления: срез «куда едет» (включает и клиентские заявки в эти направления) ---
  const dirFactor = new Map((input.advice?.directions ?? []).map((d) => [d.direction, d]));
  const directions: DirectionPlan[] = [];
  for (const direction of SHIPMENT_DIRECTIONS) {
    const row: DirectionPlan = {
      direction,
      history: used.map((c) => total(c.s.direction[direction]).stems),
      fact: total(factSlice.direction[direction]).stems,
      byFlower: {},
      target: q0(),
      reason: String(dirFactor.get(direction)?.reason || ""),
    };
    const factor = clampFactor(dirFactor.get(direction)?.factor ?? 1);
    for (const f of planFlowers) {
      const stems = Math.round(rate((s) => s.direction[direction]?.[f]?.stems ?? 0) * daysLeft * (growth[f] ?? 1) * factor);
      if (stems <= 0) continue;
      const h = used.reduce((a, c) => { add(a, c.s.direction[direction]?.[f]?.stems ?? 0, c.s.direction[direction]?.[f]?.sum ?? 0); return a; }, q0());
      const sum = Math.round(stems * (h.stems > 0 ? h.sum / h.stems : 0));
      row.byFlower[f] = { stems, sum };
      add(row.target, stems, sum);
    }
    if (row.target.stems > 0 || row.fact > 0 || row.history.some((x) => x > 0)) directions.push(row);
  }
  directions.sort((a, b) => b.target.stems - a.target.stems);

  const clientsFact = total(factSlice.channel.clients).sum;
  return {
    month,
    today,
    scenario,
    isCurrent,
    from,
    to,
    daysLeft,
    daysTotal,
    periods,
    flowers,
    channels,
    managers,
    directions,
    clientsFact,
    clientsMonth: clientsFact + channels[clientsIdx].target.sum,
    departed,
    notes,
  };
}

/** Правка человека: новая сумма менеджера на оставшиеся дни — цветки масштабируются в той же пропорции. */
export function scaleQtyRow(byFlower: Record<string, Qty>, by: "sum" | "stems", value: number, fallback: Record<string, number> = {}): Record<string, Qty> {
  const cur = Object.values(byFlower).reduce((a, x) => a + x[by], 0);
  const want = Math.max(0, Math.round(Number(value) || 0));
  const out: Record<string, Qty> = {};
  if (cur > 0) {
    const ratio = want / cur;
    for (const [f, x] of Object.entries(byFlower)) out[f] = { stems: Math.round(x.stems * ratio), sum: Math.round(x.sum * ratio) };
    return out;
  }
  // Было пусто — раскладываем по цене цветков (или всё в первый известный).
  const flowers = Object.keys(fallback).filter((f) => fallback[f] > 0);
  if (!flowers.length || want === 0) return out;
  const f = flowers[0];
  out[f] = by === "sum" ? { stems: Math.round(want / fallback[f]), sum: want } : { stems: want, sum: Math.round(want * fallback[f]) };
  return out;
}

/** Недельный план направления: дневной темп плана × дней недели, только недели, которые ещё не закончились. */
export function weeklySplit(month: string, from: string, daysLeft: number, stems: number, sum: number): { week: string; stems: number; sum: number }[] {
  if (daysLeft <= 0) return [];
  return weeksOfMonth(month)
    .filter((w) => w.to >= from)
    .map((w) => {
      const days = daysBetween(w.from, w.to);
      return { week: w.code, stems: Math.round((stems / daysLeft) * days), sum: Math.round((sum / daysLeft) * days) };
    });
}

// --- Что уходит модели и что от неё принимаем -------------------------------------------------

export const AI_PLAN_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "managers", "channels", "directions", "risks", "actions"],
  properties: {
    summary: { type: "string" },
    managers: {
      type: "array",
      items: { type: "object", additionalProperties: false, required: ["email", "factor", "reason"], properties: { email: { type: "string" }, factor: { type: "number" }, reason: { type: "string" } } },
    },
    channels: {
      type: "array",
      items: { type: "object", additionalProperties: false, required: ["channel", "factor", "reason"], properties: { channel: { type: "string" }, factor: { type: "number" }, reason: { type: "string" } } },
    },
    directions: {
      type: "array",
      items: { type: "object", additionalProperties: false, required: ["direction", "factor", "reason"], properties: { direction: { type: "string" }, factor: { type: "number" }, reason: { type: "string" } } },
    },
    risks: { type: "array", items: { type: "string" } },
    actions: { type: "array", items: { type: "string" } },
  },
};

const text = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/** Ответ модели проверяется как присланное из браузера: чужие строки отбрасываются, множители зажимаются. */
export function parseAiAdvice(raw: unknown, plan: AiPlan): AiAdvice {
  const r = (raw ?? {}) as Record<string, unknown>;
  const list = (v: unknown) => (Array.isArray(v) ? (v as Record<string, unknown>[]) : []);
  const emails = new Set(plan.managers.map((m) => m.email));
  const chans = new Set<string>(PLAN_CHANNELS);
  const dirs = new Set(plan.directions.map((d) => d.direction));
  return {
    summary: text(r.summary, 900),
    managers: list(r.managers)
      .map((m) => ({ email: String(m.email ?? "").trim().toLowerCase(), factor: clampFactor(m.factor), reason: text(m.reason, 260) }))
      .filter((m) => emails.has(m.email)),
    channels: list(r.channels)
      .map((c) => ({ channel: String(c.channel ?? "").trim(), factor: clampFactor(c.factor), reason: text(c.reason, 260) }))
      .filter((c) => chans.has(c.channel)),
    directions: list(r.directions)
      .map((d) => ({ direction: String(d.direction ?? "").trim(), factor: clampFactor(d.factor), reason: text(d.reason, 260) }))
      .filter((d) => dirs.has(d.direction)),
    risks: (Array.isArray(r.risks) ? r.risks : []).map((x) => text(x, 300)).filter(Boolean).slice(0, 6),
    actions: (Array.isArray(r.actions) ? r.actions : []).map((x) => text(x, 300)).filter(Boolean).slice(0, 8),
  };
}

export const AI_PLAN_SYSTEM = `Ты — коммерческий директор тепличного хозяйства в Казахстане (розы, хризантемы, эустома; срезанный цветок, который нельзя хранить дольше недели-двух). Тебе дают расчёт плана продаж на оставшиеся дни месяца, сделанный программой по истории продаж, складу и прогнозу срезки. Твоя работа — посоветовать, как ПЕРЕРАСПРЕДЕЛИТЬ план между менеджерами, каналами и направлениями, и объяснить почему.

Правила:
- Цифры плана считает программа. Ты отвечаешь МНОЖИТЕЛЯМИ к её раскладке: 1 — оставить как есть, от ${FACTOR_MIN} до ${FACTOR_MAX}. Программа сама сведёт суммы: если одному менеджеру прибавить, у остальных убавится — общий план цветка не меняется. Поэтому двигай только там, где есть причина в данных.
- Причина — одно короткое предложение по-русски с цифрой из данных (рост или падение к прошлому периоду, темп месяца, число клиентов, излишек цветка). Без общих слов и без выдумок: чего нет в данных, того не знаешь.
- Менеджер растёт от периода к периоду — можно прибавить; падает или в этом месяце идёт ниже своего темпа — не наказывай планом, а напиши, что проверить. Новому менеджеру план ниже среднего. Строку бота не трогай.
- Если цветка больше, чем обычно продаём (излишек), скажи, в какой канал или направление его вести, и прибавь туда. Если цветка не хватает — убавь там, где он дешевле всего продаётся.
- Учти указание владельца, если оно есть: оно важнее истории.
- summary — 2–3 предложения: главное про этот план. risks — до 5 рисков с цифрами. actions — до 6 конкретных действий на этот месяц (кому, что, сколько).
- В списках managers, channels, directions верни ВСЕ строки, которые тебе дали, с теми же email, кодами каналов и названиями направлений.`;

/** Компактная картина для модели: только то, по чему можно судить. */
export function aiPlanPrompt(plan: AiPlan, flowerLabel: (f: string) => string, comment: string): string {
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  const lines: string[] = [];
  lines.push(`Месяц плана: ${plan.month}. Сегодня ${plan.today}. Осталось дней: ${plan.daysLeft} из ${plan.daysTotal}. Сценарий: ${SCENARIOS.find((s) => s.code === plan.scenario)?.label}.`);
  lines.push(`Периоды истории (свежие первыми, в скобках вес): ${plan.periods.map((p) => `${p.label} — ${p.days} дн. (${pct(p.weight)})`).join("; ")}.`);
  lines.push("\nЦВЕТОК (стебли): на складе | срежем до конца месяца | доля списаний | можно продать | продадим по текущему темпу за эти дни | в плане | останется лишним | средняя цена клиентам");
  for (const f of plan.flowers) lines.push(`${flowerLabel(f.flowerType)}: ${f.stock} | ${f.forecastLeft}${f.forecastSource === "average" ? " (среднее, прогноза нет)" : f.forecastSource === "none" ? " (нет данных)" : ""} | ${pct(f.writeoffShare)} | ${f.sellable} | ${f.demandLeft} | ${f.targetLeft} | ${f.gap} | ${Math.round(f.price)} ₸`);
  lines.push("\nКАНАЛЫ (стебли): код | название | история по периодам | уже в этом месяце | план на остаток");
  for (const c of plan.channels) lines.push(`${c.channel} | ${c.label} | ${c.history.join(" / ")} | ${c.fact.stems} | ${c.target.stems}`);
  lines.push("\nМЕНЕДЖЕРЫ (₸): email | имя | выручка по периодам | уже в этом месяце | план на остаток | в день | активных клиентов | примечание");
  for (const m of plan.managers) lines.push(`${m.email} | ${m.name} | ${m.history.map((x) => Math.round(x)).join(" / ")} | ${Math.round(m.fact.sum)} | ${m.target.sum} | ${Math.round(m.perDay)} | ${m.clients} | ${m.virtual ? "бот, не менеджер" : m.isNew ? "новый" : ""}`);
  lines.push("\nНАПРАВЛЕНИЯ ОТГРУЗОК (стебли; включают и клиентские заявки в эти направления): направление | история по периодам | уже в этом месяце | план на остаток");
  for (const d of plan.directions) lines.push(`${d.direction} | ${d.history.join(" / ")} | ${d.fact} | ${d.target.stems}`);
  if (plan.notes.length) lines.push(`\nЗамечания программы: ${plan.notes.join(" ")}`);
  lines.push(`\nУказание владельца: ${comment.trim() ? comment.trim().slice(0, 600) : "нет"}`);
  return lines.join("\n");
}
