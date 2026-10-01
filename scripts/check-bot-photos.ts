/**
 * Каталог JPEG и фото из ротации (`catalog.ts`, `botPhotos.ts`, `botPhotoSend.ts`).
 *
 *   npx tsx scripts/check-bot-photos.ts
 */
import { readFile } from "node:fs/promises";
import { catalogFlowerOf, catalogFlowers, catalogPage, catalogPageHeight } from "../src/lib/catalog";
import { catalogPhotos, nudgePhotoQuestion, parseCaption, photoLabel, photoMessage, photoRefusal, pickRotationPhoto, ROTATION_FILE, type BotPhoto } from "../src/lib/botPhotos";
import { photoPrices } from "../src/lib/botPhotoSend";
import { botDecision } from "../src/lib/broadcast";
import { loadCatalogFonts, renderCatalogJpeg } from "../src/lib/catalogImage";
import type { PriceRow } from "../src/lib/priceList";

let failed = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed += 1;
  console.log(`${ok ? "OK  " : "FAIL"} ${name}${ok ? "" : `: получили ${JSON.stringify(actual)}, ждали ${JSON.stringify(expected)}`}`);
}

async function main() {
  console.log("Каталог");
  const prices = new Map<string, PriceRow>();
  const put = (f: string, v: string, g: string, p: number) => prices.set(`${f}|${v}|${g}`, { date: "2026-10-01", flowerType: f, variety: v, grade: g, price: p });
  put("chrysanthemum", "", "Высшая", 580);
  put("chrysanthemum", "", "Третья", 270);
  put("chrysanthemum", "Altaj", "Высшая", 620);
  put("rose", "Jumilia", "60", 220);
  const stock = [
    { flower: "chrysanthemum", variety: "Baltica", grade: "Третья", qty: 900 },
    { flower: "chrysanthemum", variety: "Momoko", grade: "Высшая", qty: 300 },
    { flower: "chrysanthemum", variety: "Altaj", grade: "Высшая", qty: 20 },
  ];
  const page = catalogPage({ flowerType: "chrysanthemum", prices, stock })!;
  check("сорта со склада по общей цене — одной карточкой, в наличии первыми", page.groups.map((g) => [g.varieties, g.inStock]), [
    [["Baltica", "Momoko"], true],
    [["Altaj"], false],
  ]);
  check("у Алтая своя высшая, третья — общая", page.groups[1].prices.map((p) => `${p.label} ${p.price}`), ["Высшая 620", "Третья 270"]);
  check("цветка без цен нет", catalogPage({ flowerType: "eustoma", prices, stock }), null);
  check("цветы каталога — по порядку, только с ценами", catalogFlowers(prices), ["chrysanthemum", "rose"]);
  check("только общая цена и пустой склад — «Все сорта»", catalogPage({ flowerType: "chrysanthemum", prices: new Map([["chrysanthemum||Первая", { date: "2026-10-01", flowerType: "chrysanthemum", variety: "", grade: "Первая", price: 530 }]]), stock: [] })?.groups.map((g) => g.varieties), [["Все сорта"]]);
  check("слово клиента → цветок", ["хризантемы", "Розы", "эустому", "всё"].map(catalogFlowerOf), ["chrysanthemum", "rose", "eustoma", ""]);
  const h = catalogPageHeight(page, 3);
  check("высота страницы — в разумных пределах", h >= 1350 && h <= 5000, true);

  console.log("\nФото из ротации");
  const ph = (id: string, patch: Partial<BotPhoto> = {}): BotPhoto => ({
    photoId: id,
    createdAt: "2026-10-01T10:00:00Z",
    createdByEmail: "a@b",
    flowerType: "chrysanthemum",
    variety: "",
    grade: "",
    caption: "Свежий срез",
    fileId: `F${id}`,
    fileName: "p.jpg",
    active: true,
    sentCount: 0,
    lastSentAt: "",
    ...patch,
  });
  const photos = [
    ph("1", { lastSentAt: "2026-10-01T09:00:00Z", sentCount: 3 }),
    ph("2", { lastSentAt: "2026-10-01T08:00:00Z", sentCount: 1 }),
    ph("3", { flowerType: "rose", lastSentAt: "" }),
    ph("4", { active: false }),
  ];
  check("давно не отправленное — первым (никогда — раньше всех)", pickRotationPhoto(photos)?.photoId, "3");
  check("нужный цветок — из его фото", pickRotationPhoto(photos, { flowers: ["chrysanthemum"] })?.photoId, "2");
  check("фото цветка нет — любое", pickRotationPhoto(photos, { flowers: ["eustoma"] })?.photoId, "3");
  check("выключенное не уходит", pickRotationPhoto([ph("4", { active: false })]), null);
  check("для каталога — фото цветка, свежие первыми", catalogPhotos([ph("a", { createdAt: "2026-09-01" }), ph("b", { createdAt: "2026-10-01" }), ph("c", { flowerType: "rose" })], "chrysanthemum").map((p) => p.photoId), ["b", "a"]);
  check("подпись: текст, цены списком, вопрос", photoMessage({ caption: "Свежий срез Altaj.", prices: [{ label: "Хризантема Altaj, Высшая", price: 620 }], question: nudgePhotoQuestion(1) }).split("\n"), [
    "Свежий срез Altaj.",
    "",
    "• Хризантема Altaj, Высшая — *620 ₸*",
    "",
    "Поставить вам на завтра? Для пробы — от 50 шт.",
  ]);
  check("подпись фото — цветок, сорт, категория", photoLabel({ flowerType: "rose", variety: "Jumilia", grade: "60" }), "Роза Jumilia, 60 см");
  check("цены под фото с сортом и категорией — из прайса", photoPrices({ flowerType: "chrysanthemum", variety: "Altaj", grade: "Высшая" }, { prices, stock }), [{ label: "Хризантема Altaj, Высшая", price: 620 }]);
  check(
    "только цветок — ходовые позиции (третья категория не ходовая)",
    photoPrices({ flowerType: "chrysanthemum", variety: "", grade: "" }, { prices, stock }).map((p) => p.label),
    ["Хризантема Momoko, Высшая"]
  );
  check("ИИ вписал цену — убираем", parseCaption({ caption: "Altaj всего 620 ₸ — крупный бутон." }), "Altaj всего — крупный бутон.");
  check("без цветка не сохраняем", photoRefusal({ flowerType: "", caption: "", fileId: "F1" }), "Выберите цветок");
  check("ротация вместо файла — это не фото", photoRefusal({ flowerType: "rose", caption: "", fileId: ROTATION_FILE }) !== "", true);

  console.log("\nБот: «пришлите каталог»");
  check("каталог хризантемы — не молчим", [botDecision({ reply: "", catalog: "chrysanthemum" }).silent, botDecision({ reply: "", catalog: "chrysanthemum" }).catalog], [false, "chrysanthemum"]);
  check("мусор вместо цветка — без каталога", botDecision({ reply: "Вот", catalog: "тюльпаны" }).catalog, "");

  console.log("\nКартинка");
  // Рисовальщик next/og на Windows не находит свой шрифт по пути (ошибка внутри библиотеки);
  // на Vercel (Linux) и в облачной проверке он работает. На компьютере владельца этот шаг пропускаем.
  if (process.platform === "win32") {
    console.log("пропущено на Windows — рисуется на сервере, проверяется `diag-catalog.ts --live`");
    console.log(failed === 0 ? "\nВсе проверки прошли." : `\nПровалено: ${failed}`);
    process.exit(failed === 0 ? 0 : 1);
  }
  const fonts = await loadCatalogFonts((p) => readFile(p));
  const jpg = await renderCatalogJpeg({ page, dateText: "на 01.10.2026", logo: null, hero: null, gallery: [], fonts });
  if (process.argv.includes("--save")) (await import("node:fs")).writeFileSync("catalog-test.jpg", jpg);
  check("получился JPEG", [jpg[0], jpg[1]], [0xff, 0xd8]);
  check("картинка не пустая", jpg.length > 30000, true);

  console.log(failed === 0 ? "\nВсе проверки прошли." : `\nПровалено: ${failed}`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
