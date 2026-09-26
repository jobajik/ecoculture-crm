import { FARM_LABELS } from "./constants";
import { apiPayConfig, configuredFarms, getAccountHealth } from "./apipay";
import { parseAccountHealth, type KaspiHealthParsed } from "./kaspiHealth";

/*
 * Серверная часть проверки Kaspi-кассы: спрашивает ApiPay и помнит ответ.
 *
 * Полоса «касса отключилась» стоит на всех страницах «Оплат» и на главной у
 * бухгалтера и админа, поэтому спрашивать ApiPay на каждую отрисовку нельзя —
 * ответ запоминается: «всё хорошо» на 3 минуты, «сломано» на 1 минуту (чтобы
 * после переподключения полоса ушла быстро). Память — на экземпляр сервера;
 * для подсказки этого достаточно.
 */

export interface KaspiFarmHealth extends KaspiHealthParsed {
  farm: string;
  label: string;
}

const OK_TTL = 3 * 60 * 1000;
const BROKEN_TTL = 60 * 1000;
// Память общая на процесс через globalThis: серверные действия и отрисовка
// страниц в Next.js собираются в разные бандлы со своими копиями модуля, и
// «забыть» из действия переподключения иначе не доходило бы до страницы.
type Memo = Map<string, { at: number; health: KaspiFarmHealth }>;
const holder = globalThis as unknown as { __kaspiHealthMemo?: Memo };
const memo: Memo = (holder.__kaspiHealthMemo ??= new Map());

async function checkFarm(farm: string): Promise<KaspiFarmHealth> {
  const label = FARM_LABELS[farm] ?? farm;
  const hit = memo.get(farm);
  if (hit) {
    const ttl = hit.health.state === "broken" ? BROKEN_TTL : OK_TTL;
    if (Date.now() - hit.at < ttl) return hit.health;
  }
  const cfg = apiPayConfig(farm);
  let health: KaspiFarmHealth;
  try {
    health = cfg
      ? { farm, label, ...parseAccountHealth(await getAccountHealth(cfg)) }
      : { farm, label, state: "unknown", reason: "", since: "", holding: false, holdingSince: "" };
  } catch {
    // Не дозвонились до ApiPay — это «не знаю», а не «сломано» (грабли 1.14).
    health = { farm, label, state: "unknown", reason: "", since: "", holding: false, holdingSince: "" };
  }
  memo.set(farm, { at: Date.now(), health });
  return health;
}

/** Состояние касс всех подключённых компаний. Никогда не бросает. */
export async function getKaspiHealth(): Promise<KaspiFarmHealth[]> {
  return Promise.all(configuredFarms().map(checkFarm));
}

/** Кассы, которые сейчас точно не работают. */
export async function brokenKaspiFarms(): Promise<KaspiFarmHealth[]> {
  return (await getKaspiHealth()).filter((h) => h.state === "broken");
}

/**
 * ApiPay только что отказал в счёте из-за потерянного входа кассира — не ждём
 * следующей проверки, полоса появится на следующей же странице.
 */
export function noteKaspiSessionLost(farm: string): void {
  memo.set(farm, {
    at: Date.now(),
    health: {
      farm,
      label: FARM_LABELS[farm] ?? farm,
      state: "broken",
      reason: "Kaspi сбросил вход кассира — ApiPay не может выставлять счета",
      since: new Date().toISOString(),
      holding: false,
      holdingSince: "",
    },
  });
}

/** Кассира переподключили — забыть «сломано», следующая страница спросит ApiPay заново. */
export function forgetKaspiHealth(farm: string): void {
  memo.delete(farm);
}
