/*
 * Заводит карточки НАШИХ магазинов на вкладке Clients.
 *
 * Шесть точек руками — это шесть шансов написать название по-разному, а разное
 * название означает разные карточки и развалившуюся историю поставок. Здесь
 * название собирается по одному правилу: «Цветочник, <короткий адрес>».
 * Короткий адрес — то, чем точку называют между собой («Достык 27»), а полный
 * лежит отдельно, в поле адреса доставки: по нему едет водитель.
 *
 * Скрипт идемпотентный: карточка с таким же названием ОБНОВЛЯЕТСЯ, новая не
 * создаётся. Значит его можно запустить дважды и ничего не сломать.
 *
 * Направление проверяется по константам до записи: неизвестное значение
 * останавливает скрипт целиком, а не пишет половину.
 *
 * Запуск: npx tsx scripts/add-shops.ts
 */
import * as dotenv from "dotenv";
import { readTable, appendRows, rowToRecord, updateWhere, SHEET_TABS } from "../src/lib/sheets";
import { RETAIL_TERRITORIES, RETAIL_LABELS, CLIENT_TYPES } from "../src/lib/constants";
import { generateId } from "../src/lib/id";

dotenv.config({ path: ".env.local" });
dotenv.config();

/** Кто ведёт эти точки. Почту менеджера розницы можно поменять в таблице. */
const MANAGER_EMAIL = (process.env.RETAIL_MANAGER_EMAIL || "").trim().toLowerCase();

interface ShopInput {
  /** Короткий адрес — то, как точку называют между собой. Идёт в название. */
  shortAddress: string;
  /** Полный адрес для водителя. */
  address: string;
  city: string;
  territory: string;
  note?: string;
}

const BRAND = "Цветочник";

const SHOPS: ShopInput[] = [
  {
    shortAddress: "Достык 27",
    address: "Проспект Достык, 27, 1 этаж",
    city: "Алматы",
    territory: RETAIL_TERRITORIES.ALMATY,
  },
  {
    shortAddress: "Достык 296",
    address: "Проспект Достык, 296, 1 этаж",
    city: "Алматы",
    territory: RETAIL_TERRITORIES.ALMATY,
  },
  {
    shortAddress: "Сатпаева 32",
    address: "Улица Каныша Сатпаева, 32, 1 этаж",
    city: "Алматы",
    territory: RETAIL_TERRITORIES.ALMATY,
  },
  {
    shortAddress: "Муратбаева 147/10",
    address: "Улица Муратбаева, 147/10",
    city: "Алматы",
    territory: RETAIL_TERRITORIES.ALMATY,
  },
  {
    shortAddress: "Гагарина 100",
    address: "Проспект Гагарина, 100, цокольный этаж",
    city: "Алматы",
    territory: RETAIL_TERRITORIES.ALMATY,
  },
  {
    shortAddress: "Мамыр-1, 8 киоск",
    address: "Микрорайон Мамыр-1, 8 киоск",
    city: "Алматы",
    territory: RETAIL_TERRITORIES.ALMATY,
    note: "Киоск",
  },
];

function shopName(shop: ShopInput): string {
  return `${BRAND}, ${shop.shortAddress}`;
}

async function main() {
  // Проверяем ВСЁ до первой записи: упасть на целой таблице лучше, чем на
  // наполовину заполненной.
  const known = Object.values(RETAIL_TERRITORIES) as string[];
  for (const shop of SHOPS) {
    if (!known.includes(shop.territory)) {
      throw new Error(`Неизвестное направление розницы: «${shop.territory}»`);
    }
    if (!shop.shortAddress.trim() || !shop.address.trim() || !shop.city.trim()) {
      throw new Error(`У точки «${shopName(shop)}» не заполнен адрес или город`);
    }
  }

  const table = await readTable(SHEET_TABS.CLIENTS);
  const existing = new Map<string, string>();
  for (const row of table.rows) {
    const record = rowToRecord(SHEET_TABS.CLIENTS, row);
    const name = (record.Name || "").trim();
    if (name) existing.set(name.toLowerCase(), record.ClientID || "");
  }

  const creates: Record<string, unknown>[] = [];
  let updated = 0;

  for (const shop of SHOPS) {
    const name = shopName(shop);
    const clientId = existing.get(name.toLowerCase());

    if (clientId) {
      await updateWhere(
        SHEET_TABS.CLIENTS,
        (record) => record.ClientID === clientId,
        () => ({
          City: shop.city,
          ShopName: shop.shortAddress,
          ClientType: CLIENT_TYPES[0],
          Address: shop.address,
          Note: shop.note ?? "",
          Retail: shop.territory,
          Active: "TRUE",
          ...(MANAGER_EMAIL ? { ManagerEmail: MANAGER_EMAIL } : {}),
        })
      );
      updated++;
      console.log(`обновлено  ${name}`);
      continue;
    }

    creates.push({
      ClientID: generateId("CLI"),
      CreatedAt: new Date().toISOString(),
      Name: name,
      City: shop.city,
      ShopName: shop.shortAddress,
      ClientType: CLIENT_TYPES[0],
      ContactPerson: "",
      Phone: "",
      Messenger: "",
      Address: shop.address,
      // Условий оплаты и способа оплаты у своего магазина нет: счёта ему не
      // выставляют. Оставляем пустыми намеренно.
      PaymentTerms: "",
      Source: "",
      Note: shop.note ?? "",
      ManagerEmail: MANAGER_EMAIL,
      Active: "TRUE",
      PaymentMethod: "",
      KaspiPay1: "",
      KaspiPay2: "",
      Retail: shop.territory,
    });
    console.log(`создано    ${name}`);
  }

  if (creates.length > 0) await appendRows(SHEET_TABS.CLIENTS, creates);

  console.log(
    `\nГотово: создано ${creates.length}, обновлено ${updated}. ` +
      `Направление — ${RETAIL_LABELS[RETAIL_TERRITORIES.ALMATY]}.`
  );
  if (!MANAGER_EMAIL) {
    console.log(
      "Менеджер у карточек не проставлен: почта не задана в RETAIL_MANAGER_EMAIL. " +
        "Точки видны всей рознице Алматы, это не мешает работе."
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
