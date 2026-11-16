/**
 * Текст голосового предложения — то, что будет произнесено (16.11.2026, владелец: «отправь мне и Данияру в качестве
 * теста предложение голосом»). Голос — стандартный синтетический, НЕ голос сотрудника: копия голоса человека возможна
 * только с его записанным согласием и одобрением сервиса, а слушателю положено говорить, что голос сгенерирован.
 *
 * Текст собирает код из склада и прайса, а не модель: цены и наличие не выдумываются. Писать приходится «для уха»:
 * без значков, сокращений и латиницы — «Altaj» синтезатор читает по-английски, поэтому названия, которые мы знаем,
 * даются по-русски, а незнакомые опускаются. Модуль чистый — проверка `check-voice-offer`.
 */

export interface VoiceStockRow {
  flower: string;
  variety: string;
  grade: string;
  qty: number;
  price: number;
}

/** Как произносить название сорта. Нет в списке — сорт вслух не называем. */
const SPOKEN_VARIETY: Record<string, string> = {
  altaj: "Алтай",
  bacardi: "Бакарди",
  jumilia: "Джумилия",
  jana: "Яна",
  "alissa pink": "Алисса розовая",
  "alissa white": "Алисса белая",
};

const GRADE_WORD: Record<string, string> = {
  Высшая: "высшая категория",
  Первая: "первая категория",
  Вторая: "вторая категория",
  Третья: "третья категория",
  Четвёртая: "четвёртая категория",
};

const FLOWER_WORD: Record<string, string> = { chrysanthemum: "хризантема", chrysanthemum_rf: "хризантема", rose: "роза", eustoma: "эустома" };

/** Цена для уха: целое число тенге, без значка валюты. */
const spokenPrice = (price: number) => `${Math.round(price)} тенге`;

export interface VoiceOfferLine {
  flower: string;
  /** Готовая фраза: «хризантема Алтай, вторая категория, 400 тенге за стебель». */
  text: string;
}

/**
 * Что предложить голосом: у хризантемы — сорт с самым большим запасом и две его категории, где цветка больше всего;
 * у розы — длина с самым большим запасом и самая низкая цена этой длины («от … тенге»). Берём только то, что есть на
 * складе (от `minQty` стеблей) и имеет цену.
 */
export function pickVoiceOffers(rows: VoiceStockRow[], minQty = 100): VoiceOfferLine[] {
  const ok = rows.filter((r) => r.qty >= minQty && r.price > 0);
  const lines: VoiceOfferLine[] = [];

  const chrys = ok.filter((r) => r.flower === "chrysanthemum" || r.flower === "chrysanthemum_rf");
  const byVariety = new Map<string, VoiceStockRow[]>();
  for (const r of chrys) byVariety.set(r.variety, [...(byVariety.get(r.variety) ?? []), r]);
  const best = Array.from(byVariety.values()).sort((a, b) => b.reduce((s, r) => s + r.qty, 0) - a.reduce((s, r) => s + r.qty, 0))[0];
  if (best) {
    const name = SPOKEN_VARIETY[best[0].variety.trim().toLowerCase()] ?? "";
    const grades = best
      .filter((r) => GRADE_WORD[r.grade])
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 2)
      .sort((a, b) => b.price - a.price);
    if (grades.length) {
      lines.push({
        flower: "chrysanthemum",
        text: `хризантема${name ? ` ${name}` : ""}: ${grades.map((g) => `${GRADE_WORD[g.grade]} по ${spokenPrice(g.price)} за стебель`).join(", ")}`,
      });
    }
  }

  const roses = ok.filter((r) => r.flower === "rose" && /^\d+$/.test(r.grade));
  const byLength = new Map<string, VoiceStockRow[]>();
  for (const r of roses) byLength.set(r.grade, [...(byLength.get(r.grade) ?? []), r]);
  const length = Array.from(byLength.entries()).sort((a, b) => b[1].reduce((s, r) => s + r.qty, 0) - a[1].reduce((s, r) => s + r.qty, 0))[0];
  if (length) {
    const from = Math.min(...length[1].map((r) => r.price));
    const many = new Set(length[1].map((r) => r.price)).size > 1;
    lines.push({ flower: "rose", text: `роза ${length[0]} сантиметров ${many ? "от" : "по"} ${spokenPrice(from)} за стебель` });
  }
  return lines;
}

/** Весь текст для озвучки. Пусто — предлагать нечего. */
export function voiceOfferText(lines: VoiceOfferLine[]): string {
  if (lines.length === 0) return "";
  const body = lines.map((l, i) => (i === 0 ? `Сегодня есть ${l.text}.` : `И ${l.text}.`)).join(" ");
  return `Здравствуйте! Это Экокультура, свежий срез из нашей теплицы. ${body} Сколько вам поставить на завтра? Напишите количество, и мы оформим заявку.`;
}

/** Подпись к тестовому аудио: слушателю положено знать, что голос сгенерирован. */
export function voiceTestNote(spoken: string): string {
  return ["Тест голосового предложения Ecoculture.", "Голос сгенерирован ИИ - стандартный, это не голос Эмиля и не живая запись.", "", `Текст: ${spoken}`].join("\n");
}

export { FLOWER_WORD };
