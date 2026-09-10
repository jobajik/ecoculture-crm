/* Бонусы и лидерборд: расчёт кода против ручного счёта. */
import { getLeaderboard } from "../src/lib/leaderboard";
import { bonusRateFor, PAYMENT_METHODS } from "../src/lib/constants";

const NOW = new Date("2026-09-08T12:00:00"); // вторник

const users = [
  { email: "m1@x.kz", name: "Айгерим", role: "manager", farm: null, active: true },
  { email: "m2@x.kz", name: "Ержан", role: "manager", farm: null, active: true },
  { email: "m3@x.kz", name: "Без продаж", role: "manager", farm: null, active: true },
] as never as Awaited<ReturnType<typeof import("../src/lib/repo/users").listUsers>>;

function ord(
  id: string,
  manager: string,
  createdAt: string,
  paid: boolean,
  items: [string, number, number][], // [тип, количество, цена]
  /** Частичная оплата: доля от 0 до 1. По умолчанию — как флаг. */
  paidShare?: number
) {
  const total = items.reduce((s, [, q, p]) => s + q * p, 0);
  const paidAmount = paidShare !== undefined ? total * paidShare : paid ? total : 0;
  return {
    orderId: id,
    clientName: `Клиент ${id}`,
    clientPhone: "",
    managerEmail: manager,
    status: "new",
    notes: "",
    deliveryDate: createdAt.slice(0, 10),
    createdAt,
    managerConfirmed: true,
    managerConfirmedAt: "",
    paid: paidAmount >= total && paidAmount > 0,
    paidAmount,
    promisedAt: "",
    collectionNote: "",
    paidAt: paidAmount > 0 ? createdAt : "",
    paymentMethod: paidAmount > 0 ? "Каспи" : "",
    accountantEmail: "",
    totalAmount: total,
    items: items.map(([flowerType, quantity, unitPrice]) => ({
      flowerType,
      variety: "X",
      grade: "60",
      quantity,
      unitPrice,
      shippedQuantity: 0,
    })),
  };
}

const orders = [
  // Айгерим, оплачено: розы 100×500 = 50 000 -> 1,5% = 750
  //                   хризантема 100×300 = 30 000 -> 2% = 600
  //                   ИТОГО бонус 1350
  ord("A", "m1@x.kz", "2026-09-08T09:00:00", true, [
    ["rose", 100, 500],
    ["chrysanthemum", 100, 300],
  ]),
  // Айгерим, НЕ оплачено: эустома 50×400 = 20 000 -> бонус 300 «ждёт»
  ord("B", "m1@x.kz", "2026-09-08T10:00:00", false, [["eustoma", 50, 400]]),
  // Ержан, оплачено: эустома 200×250 = 50 000 -> 1,5% = 750
  ord("C", "m2@x.kz", "2026-09-08T11:00:00", true, [["eustoma", 200, 250]]),
  // Ержан, отменена — не считается нигде
  { ...ord("D", "m2@x.kz", "2026-09-08T12:00:00", true, [["rose", 1000, 1000]]), status: "cancelled" },
  // Айгерим, прошлый месяц — в сентябрьский период не попадает
  ord("E", "m1@x.kz", "2026-08-20T10:00:00", true, [["rose", 1000, 1000]]),
] as never as Awaited<ReturnType<typeof import("../src/lib/repo/orders").listOrdersWithItems>>;

const plans = new Map([
  ["m1@x.kz", { targetAmount: 200_000, targetStems: 0 }],
  ["m3@x.kz", { targetAmount: 100_000, targetStems: 0 }],
]);

let fails = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) fails++;
  console.log(`${ok ? "OK  " : "FAIL"} ${label}: ${JSON.stringify(actual)}${ok ? "" : ` (ждали ${JSON.stringify(expected)})`}`);
}

async function main() {
  // --- ставки ---
  check("ставка роза", bonusRateFor("rose"), 0.015);
  check("ставка эустома", bonusRateFor("eustoma"), 0.015);
  check("ставка хризантема", bonusRateFor("chrysanthemum"), 0.02);
  check("неизвестный тип даёт 0", bonusRateFor("tulip"), 0);
  // Список закрытый и короткий намеренно: свободный ввод способа оплаты
  // за месяц даёт «каспи», «Каспи» и «kaspi» — три несводимые строки.
  check(
    "способы оплаты",
    [...PAYMENT_METHODS],
    ["Каспи", "Наличные", "Оплата по реквизитам"]
  );

  const inj = { orders, users, plans };

  // --- МЕСЯЦ ---
  const m = await getLeaderboard("month", undefined, NOW, inj);
  const a = m.rows.find((r) => r.managerEmail === "m1@x.kz")!;
  const e = m.rows.find((r) => r.managerEmail === "m2@x.kz")!;

  check("Айгерим: оплачено", a.paidAmount, 80_000);
  check("Айгерим: не оплачено", a.pendingAmount, 20_000);
  // 50 000 × 1,5% = 750 ; 30 000 × 2% = 600
  check("Айгерим: бонус роза", Math.round(a.bonusByFlowerType.rose), 750);
  check("Айгерим: бонус хризантема", Math.round(a.bonusByFlowerType.chrysanthemum), 600);
  check("Айгерим: бонус всего", Math.round(a.bonus), 1350);
  check("Айгерим: бонус в ожидании", Math.round(a.pendingBonus), 300);

  check("Ержан: оплачено", e.paidAmount, 50_000);
  check("Ержан: бонус", Math.round(e.bonus), 750);
  check("отменённая не попала в бонус", e.totalAmount, 50_000);

  check("первое место — Айгерим", m.rows[0].name, "Айгерим");
  check("ранги подряд", m.rows.map((r) => r.rank), [1, 2, 3]);
  check("бонусный фонд", Math.round(m.totals.bonus), 2100);

  // менеджер без продаж, но с планом — в таблице есть, с нулями
  const z = m.rows.find((r) => r.managerEmail === "m3@x.kz")!;
  check("менеджер без продаж виден", [z.paidAmount, z.bonus, z.targetAmount], [0, 0, 100_000]);

  // план: 80 000 из 200 000 = 40%
  check("Айгерим: выполнение плана %", Math.round(a.progressPercent), 40);
  check("план показывается на месяце", m.hasPlans, true);

  // --- ДЕНЬ: те же заявки 8 сентября, август отсекается ---
  const d = await getLeaderboard("day", undefined, NOW, inj);
  check("день: бонусный фонд тот же", Math.round(d.totals.bonus), 2100);
  check("день: план не показываем", d.hasPlans, false);
  check("день: план обнулён", d.rows.every((r) => r.targetAmount === 0), true);

  // --- август: только заявка E, роза 1 000 000 -> бонус 15 000 ---
  const aug = await getLeaderboard("month", "2026-08-15", NOW, inj);
  check("август: оплачено", aug.totals.paidAmount, 1_000_000);
  check("август: бонус", Math.round(aug.totals.bonus), 15_000);

  // --- сходимость: сумма бонусов по типам = общий бонус ---
  const sumByType = m.rows.reduce(
    (s, r) => s + Object.values(r.bonusByFlowerType).reduce((x, v) => x + v, 0),
    0
  );
  check("бонус по типам = общий бонус", Math.round(sumByType), Math.round(m.totals.bonus));

  console.log(fails === 0 ? "\nВсе проверки прошли." : `\nПровалено: ${fails}`);
  process.exit(fails === 0 ? 0 : 1);
}

main();
