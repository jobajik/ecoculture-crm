/**
 * Поручения сотрудников основному номеру (`staffCommand.ts`): разбор ответа модели, поиск клиента по имени,
 * ответ цифрой, выбор фото. Живой случай 20.10.2026: «Отправь фотографии хризантемы всех категорий и эустому
 * белого и розового цвета, клиенту Маргарита Пожарка».
 *
 *   npx tsx scripts/check-staff-command.ts
 */
import { matchTargets, parseStaffCommand, pickedNumber, pickStaffPhotos, staffAskText, staffDoneText, STAFF_MAX_PHOTOS, type StaffTarget } from "../src/lib/staffCommand";
import type { BotPhoto } from "../src/lib/botPhotos";

let failed = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "✓" : "✗"} ${name}${ok ? "" : `\n    ждали: ${JSON.stringify(expected)}\n    вышло: ${JSON.stringify(actual)}`}`);
}

// --- Разбор ответа модели
const cmd = parseStaffCommand({
  intent: "send",
  client: "Маргарита Пожарка",
  phone: "",
  items: [
    { flowerType: "chrysanthemum", variety: "", grade: "", many: true },
    { flowerType: "eustoma", variety: "Alissa White", grade: "", many: false },
    { flowerType: "eustoma", variety: "Alissa Pink", grade: "", many: false },
    { flowerType: "tulip", variety: "X", grade: "", many: false },
  ],
  text: "",
});
check("поручение: отправить", cmd.intent, "send");
check("незнакомый цветок отброшен", cmd.items.length, 3);
check("непонятный intent → none", parseStaffCommand({ intent: "hack" }).intent, "none");
check("номер — только цифры", parseStaffCommand({ intent: "send", phone: "+7 (708) 665-71-72" }).phone, "77086657172");

// --- Кому
const t = (phone: string, name: string, kind: string, managerEmail = "", lastAt = ""): StaffTarget => ({ phone, name, kind, managerEmail, lastAt });
const cands = [
  { text: "Маргарита Алматы", target: t("77023535517", "Маргарита", "клиент", "ilyas@x") },
  { text: "Маргарита Турксиб Алматы", target: t("77474270064", "Маргарита Турксиб", "клиент", "emil@x") },
  { text: "Пожарка Алматы", target: t("77078490419", "Пожарка", "клиент", "sayat@x") },
  { text: "Маргарита", target: t("77086657172", "Маргарита", "лид", "emil@x", "2026-10-20T15:40:00Z") },
  { text: "Маргарита Пожарка", target: t("77086657172", "Маргарита Пожарка", "лид", "emil@x", "2026-10-21T04:35:00Z") },
  { text: "Маргарита Пожарка", target: t("77086657172", "Маргарита Пожарка", "WhatsApp", "", "2026-10-21T04:35:00Z") },
  { text: "Евгения Пожарка", target: t("77026121425", "Евгения Пожарка", "лид") },
];
const found = matchTargets("Маргарита Пожарка", cands, "emil@x");
check("«Маргарита Пожарка» — один номер", found.map((x) => x.phone), ["77086657172"]);
check("имя — из карточки, а не из WhatsApp", found[0].kind, "лид");
check("падеж: «Маргарите Пожарке» тоже находит", matchTargets("Маргарите Пожарке", cands).map((x) => x.phone), ["77086657172"]);
const many = matchTargets("Маргарита", cands, "emil@x");
check("«Маргарита» — несколько, свои выше", many.map((x) => x.phone).slice(0, 2), ["77086657172", "77474270064"]);
check("пустой запрос — никого", matchTargets("", cands), []);
check("список для выбора — цифрами", staffAskText("Маргарита", many).split("\n")[2], "1. Маргарита Пожарка · …7172 (лид)");

check("ответ «2»", pickedNumber("2"), 2);
check("ответ «2.»", pickedNumber(" 2. "), 2);
check("ответ «номер 3»", pickedNumber("номер 3"), 3);
check("текст — не цифра", pickedNumber("2 сорт есть?"), 0);

// --- Фото
const ph = (id: string, patch: Partial<BotPhoto>): BotPhoto =>
  ({ photoId: id, fileId: `F-${id}`, fileName: `${id}.jpg`, flowerType: "chrysanthemum", variety: "", grade: "", caption: `подпись ${id}`, active: true, sentCount: 0, lastSentAt: "", createdAt: "", kind: "", ...patch }) as BotPhoto;
const photos = [
  ph("altaj", { variety: "Altaj" }),
  ph("bacardy", { variety: "Bacardy" }),
  ph("chik", { variety: "Chik" }),
  ph("yellow", { variety: "Altay yellow" }),
  ph("generic", {}),
  ph("info", { variety: "Altaj", kind: "info" }),
  ph("w1", { flowerType: "eustoma", variety: "Alissa White" }),
  ph("w2", { flowerType: "eustoma", variety: "Alissa White" }),
  ph("w3", { flowerType: "eustoma", variety: "Alissa White" }),
  ph("p1", { flowerType: "eustoma", variety: "Alissa Pink" }),
  ph("off", { flowerType: "eustoma", variety: "Alissa Pink", active: false }),
];
const pick = pickStaffPhotos(photos, cmd.items);
const ids = pick.picked.map((p) => p.photoId);
check("хризантема «все категории» — 4 фото разных сортов, живые первыми", ids.slice(0, 4), ["altaj", "bacardy", "chik", "yellow"]);
check("белая эустома — 2 фото", ids.filter((i) => i.startsWith("w")).length, 2);
check("розовая — одно (второе выключено)", ids.filter((i) => i.startsWith("p")), ["p1"]);
check("ничего не пропало", pick.missing, []);
check("инфографика — только при «все категории», и последней в своём пункте",
  pickStaffPhotos([ph("info", { variety: "Altaj", kind: "info" }), ph("altaj", { variety: "Altaj" })], [{ flowerType: "chrysanthemum", variety: "", grade: "", many: true }]).picked.map((p) => p.photoId),
  ["altaj", "info"]);
check("о сорте без «всех» — инфографика не идёт", pickStaffPhotos(photos, [{ flowerType: "chrysanthemum", variety: "Bacardy", grade: "", many: false }]).picked.map((p) => p.photoId), ["bacardy"]);
check("нет фото — в «нет в CRM»", pickStaffPhotos(photos, [{ flowerType: "rose", variety: "", grade: "Мини-микс", many: false }]).missing, ["Роза, Мини-микс"]);
const lots = Array.from({ length: 30 }, (_, i) => ph(`r${i}`, { flowerType: "rose", variety: `V${i}` }));
check("не больше предела за поручение", pickStaffPhotos(lots, Array.from({ length: 8 }, () => ({ flowerType: "rose", variety: "", grade: "", many: true }))).picked.length, STAFF_MAX_PHOTOS);

check(
  "отчёт сотруднику",
  staffDoneText({ name: "Маргарита Пожарка", phone: "77086657172", via: "номера Эмиля", sent: ["Хризантема Altaj"], missing: [], text: false }),
  "Отправил Маргарита Пожарка (…7172) с номера Эмиля:\n• Хризантема Altaj"
);

console.log(failed === 0 ? "\nВсе проверки прошли." : `\nПровалено: ${failed}`);
process.exit(failed === 0 ? 0 : 1);
