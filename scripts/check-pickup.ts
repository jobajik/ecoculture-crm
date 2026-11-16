/*
 * Склады для самовывоза (16.11.2026, адреса владельца — `src/lib/pickupPoints.ts`).
 * Стережём: город узнаётся в разных написаниях (регистр, «г.», дефис, казахское название), а похожий, но другой город —
 * нет; подтверждение заказа бота называет склад города, а без склада — по-старому «из офиса»; подсказка модели знает
 * все пять адресов и правило «только город клиента».
 *
 * Запуск: npx tsx scripts/check-pickup.ts
 */
import { PICKUP_POINTS, pickupCityKey, pickupPointFor, pickupPromptBlock } from "../src/lib/pickupPoints";
import { botOrderText, pickupOrAddressLine } from "../src/lib/botOrder";

let fails = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) fails++;
  console.log(`${ok ? "OK  " : "FAIL"} ${label}: ${JSON.stringify(actual)}${ok ? "" : ` (ждали ${JSON.stringify(expected)})`}`);
}

console.log("— Адреса —");
check("пять складов", PICKUP_POINTS.map((p) => p.city), ["Алматы", "Усть-Каменогорск", "Семей", "Караганда", "Астана"]);
check("Алматы", pickupPointFor("Алматы")?.address, "мкр Аксай-3а, д. 62а, здание Агроцентра");
check("Усть-Каменогорск", pickupPointFor("Усть-Каменогорск")?.address, "ул. Бажова 91, Цветочник");
check("Семей", pickupPointFor("Семей")?.address, "ул. Ибраева 147");
check("Караганда", pickupPointFor("Караганда")?.address, "ул. Молокова 104, бутик 29 (4 корпус), склады МАДИ");
check("Астана", pickupPointFor("Астана")?.address, "ул. Жошы хана 1/2");
check("у каждого написания — один склад", (() => {
  const all = PICKUP_POINTS.flatMap((p) => p.aliases);
  return all.length === new Set(all).size;
})(), true);
check("написания уже в виде ключа", PICKUP_POINTS.every((p) => p.aliases.every((a) => pickupCityKey(a) === a)), true);

console.log("\n— Город в разных написаниях —");
const city = (s: string) => pickupPointFor(s)?.city ?? null;
check("«г. Астана»", city("г. Астана"), "Астана");
check("«г.Алматы»", city("г.Алматы"), "Алматы");
check("«город Семей»", city("город Семей"), "Семей");
check("«АЛМАТЫ » с пробелом", city(" АЛМАТЫ "), "Алматы");
check("«Алма-Ата»", city("Алма-Ата"), "Алматы");
check("«Оскемен» и «Өскемен»", [city("Оскемен"), city("Өскемен")], ["Усть-Каменогорск", "Усть-Каменогорск"]);
check("«Усть Каменогорск» без дефиса", city("Усть Каменогорск"), "Усть-Каменогорск");
check("«Қарағанды»", city("Қарағанды"), "Караганда");
check("«Нур-Султан»", city("Нур-Султан"), "Астана");
check("«Семипалатинск»", city("Семипалатинск"), "Семей");
check("«Алматы.» с точкой", city("Алматы."), "Алматы");

console.log("\n— Чего угадывать нельзя —");
check("«Алмалы» — не Алматы", city("Алмалы"), null);
check("Шымкент — склада нет", city("Шымкент"), null);
check("Бишкек — склада нет", city("Бишкек"), null);
check("пустой город", city(""), null);
check("нет города", pickupPointFor(undefined), null);
check("«Гусь» не режется как «г.»", pickupCityKey("Гусь"), "гусь");

console.log("\n— Подтверждение заказа бота —");
check("город со складом — адрес склада", pickupOrAddressLine("Караганда"), "Напишите адрес доставки — или заберёте сами со склада: ул. Молокова 104, бутик 29 (4 корпус), склады МАДИ.");
check("город без склада — по-старому", pickupOrAddressLine("Шымкент"), "Напишите адрес доставки — или заберёте сами из офиса.");
const order = (address: string | undefined, c: string) =>
  botOrderText({
    code: "AB12C",
    items: [{ flowerType: "chrysanthemum", variety: "Altaj", grade: "Третья", quantity: 200, unitPrice: 270 }],
    deliveryDate: "2026-11-17",
    city: c,
    invoices: [],
    address,
  });
check("адреса нет — склад города в тексте", order("", "Семей").includes("заберёте сами со склада: ул. Ибраева 147"), true);
check("адрес известен — про склад не пишем", order("ул. Абая 10", "Семей").includes("заберёте сами"), false);
check("адрес не передан — строки нет", order(undefined, "Алматы").includes("заберёте сами"), false);

console.log("\n— Подсказка модели —");
const block = pickupPromptBlock();
check("все адреса в подсказке", PICKUP_POINTS.every((p) => block.includes(`${p.city}: ${p.address}`)), true);
check("правило: город клиента, не списком", [block.includes("ГОРОДА КЛИЕНТА"), block.includes("списком не выкладывай")], [true, true]);
check("правило: не выдумывать часы и дорогу", block.includes("Часы работы, ориентиры и как проехать не выдумывай"), true);
check("правило: «сегодня» по адресу не обещать", block.includes("«сегодня»\nпо адресу не обещай"), true);

console.log(fails ? `\nНЕ ПРОШЛО: ${fails}` : "\nВсе проверки прошли.");
process.exit(fails ? 1 : 0);
