/**
 * Телефон в одном виде (`src/lib/phone.ts`): «+77015552030».
 *
 *   npx tsx scripts/check-phone.ts
 */
import { formatPhone, maskPhoneInput, phoneComplete } from "../src/lib/phone";

let failed = 0;
function eq(name: string, got: unknown, want: unknown) {
  if (got !== want) {
    failed += 1;
    console.log(`✗ ${name}: получили «${got}», ждали «${want}»`);
  } else console.log(`✓ ${name}`);
}

console.log("--- запись в таблицу (formatPhone)");
eq("8 с пробелами", formatPhone("8 701 555 20 30"), "+77015552030");
eq("+7 со скобками и дефисами", formatPhone("+7 (701) 555-20-30"), "+77015552030");
eq("7 без плюса", formatPhone("77015552030"), "+77015552030");
eq("10 цифр", formatPhone("701 555 2030"), "+77015552030");
eq("уже в нужном виде", formatPhone("+77015552030"), "+77015552030");
eq("пусто", formatPhone(""), "");
eq("неполный — как есть", formatPhone("701 555"), "701 555");
eq("иностранный — как есть", formatPhone("+998 90 123 45 67"), "+998 90 123 45 67");
eq("текст — как есть", formatPhone(" нет "), "нет");
eq("городской Алматы", formatPhone("8 727 300 00 00"), "+77273000000");

console.log("--- полный номер");
eq("+7 и 10 цифр", phoneComplete("+77015552030"), true);
eq("с пробелом — нет", phoneComplete("+7 7015552030"), false);
eq("короткий — нет", phoneComplete("+7701555"), false);

console.log("--- маска при наборе");
// набор по одной цифре в пустое поле
const type = (keys: string, start = "") => {
  let v = start;
  for (const k of keys) v = maskPhoneInput(v + k, v);
  return v;
};
eq("набор с 8", type("87015552030"), "+77015552030");
eq("набор с 7", type("77015552030"), "+77015552030");
eq("поле с +7, набирают 701…", type("7015552030", "+7"), "+77015552030");
eq("поле с +7, набирают 8 701…", type("87015552030", "+7"), "+77015552030");
eq("больше 10 цифр не набрать", type("9", "+77015552030"), "+77015552030");
eq("вставка «8 701 555 20 30» в пустое", maskPhoneInput("8 701 555 20 30", ""), "+77015552030");
eq("вставка «+7 701 555 20 30» в +7", maskPhoneInput("+7+7 701 555 20 30", "+7"), "+77015552030");
eq("вставка «8 701…» в +7", maskPhoneInput("+78 701 555 20 30", "+7"), "+77015552030");
eq("вставка 10 цифр в пустое", maskPhoneInput("7015552030", ""), "+77015552030");
eq("стёрли всё", maskPhoneInput("+", "+7"), "");
eq("стёрли одну цифру", maskPhoneInput("+7701555203", "+77015552030"), "+7701555203");

if (failed) {
  console.log(`\nНе прошло: ${failed}`);
  process.exit(1);
}
console.log("\nВсе проверки прошли");
