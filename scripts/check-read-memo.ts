/*
 * Память чтений: три секунды считаются от ПРИХОДА данных.
 *
 * 13.11.2026, замер скорости с сервера: набор вкладок «Переписки» читался 3,5 с, а весь ответ занял 10–12 с — те же
 * вкладки скачались у Google второй раз, по одной. Срок памяти шёл от начала запроса, и долгий ответ оказывался
 * просроченным ещё до того, как его запомнили.
 *
 * Проверка стережёт обе стороны: помним слишком мало — тяжёлые страницы читают таблицу дважды; помним слишком долго —
 * человек видит старые данные дольше трёх секунд.
 *
 * Запуск: npx tsx scripts/check-read-memo.ts
 */
import { createReadMemo, READ_MEMO_MS, READ_PENDING_MS } from "../src/lib/readMemo";

let fails = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) fails++;
  console.log(`${ok ? "OK  " : "FAIL"} ${label}: ${JSON.stringify(actual)}${ok ? "" : ` (ждали ${JSON.stringify(expected)})`}`);
}
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

async function main() {
  let now = 1_000_000;
  const memo = createReadMemo<string>(() => now);

  // Долгий запрос: 3,5 секунды в пути.
  let finish: (v: string) => void = () => {};
  const slow = new Promise<string>((r) => (finish = r));
  memo.track("WaMessages", slow);
  now += 2000;
  check("запрос в пути 2 с — им пользуются", memo.get("WaMessages") === slow, true);
  now += 1500;
  check("запрос в пути 3,5 с — им всё ещё пользуются", memo.get("WaMessages") === slow, true);
  finish("данные");
  await tick();
  check("ответ пришёл через 3,5 с — запомнен", memo.has("WaMessages"), true);
  now += READ_MEMO_MS - 1;
  check("через 2,999 с после прихода — ещё годится", memo.has("WaMessages"), true);
  now += 1;
  check("через 3 с после прихода — уже нет", memo.has("WaMessages"), false);
  check("и get его не отдаёт", memo.get("WaMessages"), undefined);

  // Пакетное чтение: данные кладутся готовыми, срок — от этого момента.
  memo.put("Orders", "заявки");
  now += 2500;
  check("пакет: через 2,5 с годится", await memo.get("Orders"), "заявки");
  now += 600;
  check("пакет: через 3,1 с — нет", memo.has("Orders"), false);

  // Неудачное чтение не запоминается.
  let fail: (e: Error) => void = () => {};
  const broken = new Promise<string>((_, r) => (fail = r));
  memo.track("Leads", broken).catch(() => {});
  check("пока запрос в пути — он запомнен", memo.has("Leads"), true);
  fail(new Error("лимит"));
  await tick();
  check("запрос упал — не запомнен", memo.has("Leads"), false);

  // Повисший запрос не держит всех вечно.
  memo.track("Clients", new Promise<string>(() => {}));
  now += READ_PENDING_MS - 1;
  check("запрос висит 29,999 с — ждём его", memo.has("Clients"), true);
  now += 1;
  check("запрос висит 30 с — пробуем заново", memo.has("Clients"), false);

  // Запись сбрасывает всё, и опоздавший ответ старого запроса не воскресает.
  let late: (v: string) => void = () => {};
  const old = new Promise<string>((r) => (late = r));
  memo.track("Batches", old);
  memo.put("Users", "сотрудники");
  memo.clear();
  check("после записи память пуста", [memo.has("Batches"), memo.has("Users")], [false, false]);
  late("старые остатки");
  await tick();
  check("ответ, начатый до записи, после неё не запоминается", memo.has("Batches"), false);

  // Новый запрос той же вкладки заменяет прежний, и падение прежнего его не стирает.
  let failOld: (e: Error) => void = () => {};
  const first = new Promise<string>((_, r) => (failOld = r));
  memo.track("Payments", first).catch(() => {});
  const second = Promise.resolve("платежи");
  memo.track("Payments", second);
  failOld(new Error("сбой"));
  await tick();
  check("свежий запрос остался после падения прежнего", await memo.get("Payments"), "платежи");

  console.log(fails ? `\nНЕ ПРОШЛО: ${fails}` : "\nВсе проверки прошли.");
  process.exit(fails ? 1 : 0);
}
main();
