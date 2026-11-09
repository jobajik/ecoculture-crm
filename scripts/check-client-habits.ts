/**
 * Привычки постоянников (`src/lib/clientHabits.ts`): периодичность, день недели, обычные позиции, когда писать и текст.
 *   npx tsx scripts/check-client-habits.ts
 */
import { buildHabits, habitDue, habitGreetingName, habitText, weekdayOf, type HabitOrder } from "../src/lib/clientHabits";

let failed = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "OK  " : "FAIL"} ${label}: ${JSON.stringify(actual)}${ok ? "" : ` (ждали ${JSON.stringify(expected)})`}`);
}
const o = (day: string, client: string, items: [string, string, string, number][], mgr = "ilyas@x.kz"): HabitOrder => ({
  orderId: `O-${day}-${client}`,
  clientId: client,
  clientName: client === "C1" ? "Асель" : "ТОО Цветы 24",
  clientPhone: "+7 701 000 00 0" + client.slice(-1),
  managerEmail: mgr,
  day,
  items: items.map(([f, v, g, q]) => ({ flowerType: f, variety: v, grade: g, quantity: q, unitPrice: 300 })),
  totalAmount: items.reduce((s, i) => s + i[3] * 300, 0),
});
// Асель берёт каждую неделю по средам Altaj Третью 200 и иногда Вторую 100
const orders: HabitOrder[] = [
  o("2026-10-07", "C1", [["chrysanthemum", "Altaj", "Третья", 200]]),
  o("2026-10-14", "C1", [["chrysanthemum", "Altaj", "Третья", 220], ["chrysanthemum", "Altaj", "Вторая", 100]]),
  o("2026-10-21", "C1", [["chrysanthemum", "Altaj", "Третья", 200]]),
  o("2026-10-28", "C1", [["chrysanthemum", "Altaj", "Третья", 180], ["chrysanthemum", "Altaj", "Вторая", 100]]),
  o("2026-11-04", "C1", [["chrysanthemum", "Altaj", "Третья", 200]]),
  // две заявки в один день — один заказ для периодичности
  o("2026-11-04", "C1", [["rose", "Prestige", "60", 30]]),
  // разовый клиент
  o("2026-10-20", "C2", [["rose", "Red Naomi", "60", 300]]),
  // чужой менеджер
  o("2026-10-30", "C3", [["eustoma", "Alissa White", "Стандарт", 100]], "emil@x.kz"),
];
const today = "2026-11-09"; // понедельник
check("понедельник", weekdayOf(today), 1);
const hs = buildHabits(orders, today, { managerEmail: "ilyas@x.kz" });
check("клиентов у Ильяса", hs.map((h) => h.clientId), ["C1", "C2"]);
const a = hs[0];
check("Асель: заказов", a.orders, 5);
check("Асель: раз в неделю", a.medianGapDays, 7);
check("Асель: среда", a.weekday, 3);
check("Асель: постоянник", a.regular, true);
check("Асель: ждём 11.11", a.nextExpectedAt, "2026-11-11");
check("Асель: обычно Третья 200, потом Вторая 100", a.usual.map((u) => [u.grade, u.qty, u.times]), [["Третья", 200, 5], ["Вторая", 100, 2], ["60", 30, 1]]);
check("разовый — не постоянник", hs[1].regular, false);
check("чужой менеджер не попал", hs.some((h) => h.clientId === "C3"), false);
check("без менеджера — все", buildHabits(orders, today).length, 3);

check("пн — не её день", habitDue(a, "2026-11-09", {}), { due: false, why: "его день — ср" });
check("ср — пора", habitDue(a, "2026-11-11", {}), { due: true, why: "" });
check("ср, но писали 3 дня назад — нет", habitDue(a, "2026-11-11", { lastSentAt: "2026-11-08T05:00:00Z" }).due, false);
check("ср, писали 8 дней назад — да", habitDue(a, "2026-11-11", { lastSentAt: "2026-11-03T05:00:00Z" }).due, true);
check("ср, сама писала вчера — нет", habitDue(a, "2026-11-11", { lastClientMsgAt: "2026-11-10T14:00:00+05:00" }).why, "сам писал за сутки");
check("ср, заказала вчера — нет", habitDue(a, "2026-11-11", { orderedSince: "2026-11-10" }).why, "заказывал на днях");
check("отписалась — нет", habitDue(a, "2026-11-11", { optedOut: true }).why, "отписался");
check("разовому не пишем", habitDue(hs[1], "2026-11-09", {}).why, "не постоянник");

const t = habitText(a, "Ильяс", [
  { item: a.usual[0], price: 270, stock: 5000 },
  { item: a.usual[1], price: 400, stock: 0 },
  { item: a.usual[2], price: 235, stock: 900 },
]);
check("текст: от имени Ильяса, по имени", t.startsWith("Здравствуйте, Асель! Это Ильяс, Ecoculture."), true);
check("текст: позиция без остатка не предлагается", t.includes("Вторая"), false);
check("текст: обычное количество", t.includes("Оформить как обычно, 200 шт. Хризантема Altaj, Третья?"), true);
check("текст: без длинных тире", /[—–]/.test(t), false);
const t2 = habitText(a, "Ильяс", [{ item: a.usual[0], price: 270, stock: 0 }]);
check("ничего нет на складе — короткий текст", t2.includes("Скинуть, что есть сегодня"), true);
const t3 = habitText({ ...a, name: "ТОО Цветочный мир Караганда" }, "Эмиль", [{ item: a.usual[0], price: 270, stock: 300 }]);
check("ТОО — без обращения по имени", t3.startsWith("Здравствуйте! Это Эмиль"), true);
check("количество не больше остатка", t3.includes("200 шт."), true);
check("обращение: «Асем Каскелен» → Асем", habitGreetingName("Асем Каскелен"), "Асем");
check("обращение: «Мира новый» → Мира", habitGreetingName("Мира новый"), "Мира");
check("обращение: «Лена Фабричный» → Лена", habitGreetingName("Лена Фабричный"), "Лена");
check("обращение: одно имя", habitGreetingName("Флорентина"), "Флорентина");
check("обращение: «Цветы 24» — без имени", habitGreetingName("Цветы 24"), "");
check("обращение: «Магазин Роза» — без имени", habitGreetingName("Магазин Роза"), "");
check("обращение: «ТОО Ромашка» — без имени", habitGreetingName("ТОО Ромашка"), "");
check("обращение: «Клиент WhatsApp 1234» — без имени", habitGreetingName("Клиент WhatsApp 1234"), "");
check("обращение: «Центр цветов Романтик» — без имени", habitGreetingName("Центр цветов Романтик"), "");
check("обращение: латиница — без имени", habitGreetingName("Flowers Almaty"), "");
check("обращение: пусто", habitGreetingName(""), "");

console.log(failed ? `\nПровалено проверок: ${failed}` : "\nВсе проверки прошли.");
process.exit(failed ? 1 : 0);
