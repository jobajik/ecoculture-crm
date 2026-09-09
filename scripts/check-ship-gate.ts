/*
 * Проверка правила «цветок не уезжает раньше денег».
 *
 * Отгружать заявку можно только после двух галочек: менеджер согласовал её с
 * клиентом, бухгалтер провёл полную оплату. До этого заявка висит у зав.
 * складом в списке, но собирать по ней нельзя.
 *
 * Это тот случай, когда ошибка не падает и не видна в цифрах: кнопка стоит,
 * склад жмёт, цветок уезжает, а деньги приходят или не приходят. Поэтому
 * правило проверяется здесь, а не «на глаз» в интерфейсе.
 *
 * Запуск: npx tsx scripts/check-ship-gate.ts
 */
import { isReadyToShip, missingForShip, notReadyReason } from "../src/lib/orderReady";

let fails = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) fails++;
  console.log(
    `${ok ? "OK  " : "FAIL"} ${label}: ${JSON.stringify(actual)}${
      ok ? "" : ` (ждали ${JSON.stringify(expected)})`
    }`
  );
}

function order(managerConfirmed: boolean, paid: boolean, paidAmount: number, totalAmount = 100_000) {
  return { managerConfirmed, paid, paidAmount, totalAmount };
}

// --- Кого пускаем к отгрузке --------------------------------------------

check("новая заявка — отгружать нельзя", isReadyToShip(order(false, false, 0)), false);
check("менеджер подтвердил, денег нет", isReadyToShip(order(true, false, 0)), false);
check("деньги есть, менеджер не подтвердил", isReadyToShip(order(false, true, 100_000)), false);
check("обе галочки — можно", isReadyToShip(order(true, true, 100_000)), true);

// Предоплата открывать сборку не должна: так решил владелец.
check("предоплата 90 % — всё равно нельзя", isReadyToShip(order(true, false, 90_000)), false);

// --- Что показываем человеку --------------------------------------------

check("новая заявка — чего ждём", missingForShip(order(false, false, 0)), [
  "подтверждения менеджера",
  "оплаты",
]);
check(
  "фраза целиком",
  notReadyReason(order(false, false, 0)),
  "Ждёт подтверждения менеджера и оплаты"
);
check("готовая заявка — фразы нет", notReadyReason(order(true, true, 100_000)), "");

// Частичная оплата пишется остатком: зав. складом видит, что деньги уже идут.
// Ожидание собираем тем же toLocaleString: разделитель разрядов в русской
// локали — неразрывный пробел, и вписанный руками обычный сюда не подойдёт.
check(
  "частичная оплата — виден остаток",
  notReadyReason(order(true, false, 60_000)),
  `Ждёт остатка оплаты ${(40_000).toLocaleString("ru-RU")} ₸`
);

// Заявка у зав. складом урезана до своих позиций, а оплата приходит на всю
// заявку целиком. Тогда «получено» больше «итого» — остаток отрицательный,
// и вместо бессмыслицы вроде «остатка оплаты −20 000 ₸» пишем просто «оплаты».
check(
  "получено больше урезанной суммы — без отрицательного остатка",
  notReadyReason(order(true, false, 120_000, 100_000)),
  "Ждёт оплаты"
);

// Копейки от пересчёта по рекламации не должны держать заявку закрытой.
check(
  "остаток меньше тенге — считается оплатой, не остатком",
  notReadyReason(order(true, false, 99_999.6)),
  "Ждёт оплаты"
);

console.log(fails === 0 ? "\nВсе проверки прошли" : `\nПровалено проверок: ${fails}`);
process.exit(fails === 0 ? 0 : 1);
