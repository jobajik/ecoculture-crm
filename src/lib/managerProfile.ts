import { addDaysToKey } from "./dayKey";

// ---------------------------------------------------------------------------
// Региональный менеджер (21.10.2026, владелец: «Салтанат — менеджер Астаны, заказ по регионам формируем на
// понедельник, когда уезжает фура. Важно всех клиентов Салтанат не потерять и хранить!»; решения: заказ — на
// ближайший понедельник без срока приёма, помощник «продаёт сам», лидами — все, с кем есть переписка).
//
// Настройка `ManagerProfiles` (JSON, ставит `scripts/manager-profile.ts`): почта менеджера → город, день отправки
// фуры (1 — понедельник … 7 — воскресенье), женский род для подсказки ИИ. Где действует: заказ помощника и бота
// для её клиента — на день фуры, город карточки по умолчанию, подсказка модели; авто-лид на её номере — и на её
// исходящие, с её городом; форма заявки — дата по умолчанию. Чистые правила; проверка — `check-wa-lines`.
// ---------------------------------------------------------------------------

export const MANAGER_PROFILES_SETTING = "ManagerProfiles";

export interface ManagerProfile {
  /** Город клиентов менеджера («Астана»): карточка и лид по умолчанию, направление заявки. */
  city: string;
  /** День, когда уезжает фура: 1 — понедельник … 7 — воскресенье; null — доставка как обычно. */
  shipWeekday: number | null;
  /** Женский род в подсказке ИИ («оформила», «передала»). */
  female: boolean;
}

/** В день фуры заказ ещё успевает до этого часа (Алматы); позже — на следующую неделю. */
export const SHIP_DAY_CUTOFF_HOUR = 12;

export function parseManagerProfiles(raw: string | null | undefined): Record<string, ManagerProfile> {
  const out: Record<string, ManagerProfile> = {};
  let data: unknown;
  try {
    data = JSON.parse(raw || "{}");
  } catch {
    return out;
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return out;
  for (const [email, v] of Object.entries(data as Record<string, unknown>)) {
    const key = email.trim().toLowerCase();
    if (!key.includes("@") || !v || typeof v !== "object") continue;
    const o = v as Record<string, unknown>;
    const day = Number(o.shipWeekday);
    out[key] = {
      city: typeof o.city === "string" ? o.city.trim() : "",
      shipWeekday: Number.isInteger(day) && day >= 1 && day <= 7 ? day : null,
      female: o.female === true,
    };
  }
  return out;
}

export function profileOf(profiles: Record<string, ManagerProfile>, email: string | null | undefined): ManagerProfile | null {
  return profiles[(email || "").trim().toLowerCase()] ?? null;
}

/** День недели ключа «ГГГГ-ММ-ДД»: 1 — понедельник … 7 — воскресенье. */
export function isoWeekday(dayKey: string): number {
  const d = new Date(`${dayKey}T12:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

/** Ближайший день фуры: сегодня (если это он и ещё нет `SHIP_DAY_CUTOFF_HOUR`), иначе следующий такой день. */
export function nextShipDay(today: string, weekday: number, almatyHour: number): string {
  const now = isoWeekday(today);
  let diff = (weekday - now + 7) % 7;
  if (diff === 0 && almatyHour >= SHIP_DAY_CUTOFF_HOUR) diff = 7;
  return addDaysToKey(today, diff);
}

const WEEKDAYS = ["", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота", "воскресенье"];
const WEEKDAYS_ACC = ["", "понедельник", "вторник", "среду", "четверг", "пятницу", "субботу", "воскресенье"];

/** «понедельник, 26.10». */
export function shipDayLabel(dayKey: string): string {
  return `${WEEKDAYS[isoWeekday(dayKey)]}, ${dayKey.slice(8, 10)}.${dayKey.slice(5, 7)}`;
}

/** Блок подсказки модели: клиенты в городе менеджера, заказ уезжает фурой в день отправки. */
export function regionPromptBlock(profile: ManagerProfile, shipDay: string): string {
  if (!profile.city && !profile.shipWeekday) return "";
  const lines = ["\nТВОИ КЛИЕНТЫ — РЕГИОН:"];
  if (profile.city) lines.push(`• Ты ведёшь клиентов в городе ${profile.city}. Город у клиента не спрашивай — он ${profile.city}, если сам не сказал другой.`);
  if (profile.shipWeekday && shipDay) {
    lines.push(
      `• Цветы в ${profile.city || "регион"} уезжают фурой раз в неделю, в ${WEEKDAYS_ACC[profile.shipWeekday]}. Ближайшая отправка — ${shipDayLabel(shipDay)}: ` +
        `любой заказ оформляется на эту дату (deliveryDate = ${shipDay}), другой день доставки не обещай. Срока приёма заказов нет — ` +
        "всё, что подтвердили, едет ближайшей фурой."
    );
    lines.push("• Склад для заказа — основной (из офиса в регион не отправляем). Условия доставки по городу — только из указаний владельца, иначе «уточню и отпишусь».");
    lines.push("• День, когда фура придёт и заказ можно забрать, не обещай — «сообщу, как придёт». Оплату по своей ссылке Kaspi, которую клиенту уже прислали в переписке, не дублируй вторым счётом: прислал чек — поблагодари, и всё.");
  }
  return lines.join("\n");
}

/** Род для подсказки: «оформила», «передала» вместо мужского. */
export function feminize(prompt: string): string {
  return prompt
    .replace("от первого лица, в мужском роде («оформил», «передал»)", "от первого лица, в женском роде («оформила», «передала»)")
    .replace(/(^|[^а-яё])передал(?![а-яё])/gi, "$1передала")
    .replace(/(^|[^а-яё])оформил(?![а-яё])/gi, "$1оформила");
}
