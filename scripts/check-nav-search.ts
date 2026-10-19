/**
 * Меню из пяти разделов и общий поиск (19.10.2026, макет принят владельцем).
 *
 * Меню: у каждой роли не больше семи разделов, каждый адрес раздела и вкладки открыт этой роли (иначе пункт выкинет
 * человека на главную), на любом адресе активен ровно один раздел — и тот, что ожидается.
 * Поиск: телефон находится в любом написании, короткий номер находит заявку, чужой лид менеджеру не показывается,
 * зав. складом клиентов не видит, короткий запрос — пусто.
 */
import { navLinksFor, isActive, activeSub } from "../src/components/navLinks";
import { canOpen } from "../src/lib/access";
import { searchEverything } from "../src/lib/globalSearch";
import type { Client, Lead, OrderWithItems } from "../src/lib/types";

let fails = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) fails += 1;
  console.log(`${ok ? "OK  " : "ПЛОХО"} ${name}: ${JSON.stringify(actual)}${ok ? "" : ` (ждали ${JSON.stringify(expected)})`}`);
}

// --- Меню --------------------------------------------------------------------
const ROLES_ALL = ["admin", "manager", "sales_head", "accountant", "warehouse", "office", "office_retail", "retail_almaty", "retail_regions", "agronomist", "leadgen"];
for (const role of ROLES_ALL) {
  const links = navLinksFor(role);
  check(`${role}: разделов не больше семи`, links.length <= 7, true);
  const closed = links
    .flatMap((l) => [l.href, ...l.subs.map((s) => s.href)])
    .map((h) => h.split("?")[0])
    .filter((h) => !canOpen(role, h));
  check(`${role}: все адреса меню открыты роли`, closed, []);
  const dup = links.map((l) => l.label).filter((v, i, a) => a.indexOf(v) !== i);
  check(`${role}: названия разделов не повторяются`, dup, []);
}

function activeLabel(role: string, pathname: string): string {
  const links = navLinksFor(role);
  const on = links.filter((l) => isActive(l, pathname, links));
  return on.length === 1 ? on[0].label : `ровно один? ${on.map((l) => l.label).join(",")}`;
}
check("менеджер на лидах — «Клиенты»", activeLabel("manager", "/clients/leads"), "Клиенты");
check("менеджер на прайсе — «Продажи»", activeLabel("manager", "/prices"), "Продажи");
check("менеджер на карточке клиента — «Клиенты»", activeLabel("manager", "/clients/abc"), "Клиенты");
check("менеджер на главной — «Мой день»", activeLabel("manager", "/"), "Мой день");
check("склад офиса на отгрузке — «Офис»", activeLabel("office", "/warehouse/ship/ORD-1"), "Офис");
check("админ на календаре — «Планы и цифры»", activeLabel("admin", "/analytics/calendar"), "Планы и цифры");
check("админ на офисе — «Склад»", activeLabel("admin", "/office/moves"), "Склад");
check("админ на наших магазинах — «Клиенты»", activeLabel("admin", "/retail/shops"), "Клиенты");
check("зав. складом на регионах — «Розница»", activeLabel("warehouse", "/retail/regions"), "Розница");
check("Земфира на лидах — «Лиды»", activeLabel("leadgen", "/clients/leads/ads"), "Лиды");
check("бухгалтер на долгах — «Оплаты»", activeLabel("accountant", "/finance/debts"), "Оплаты");
check("РОП на рейтинге — «Планы и цифры»", activeLabel("sales_head", "/sales"), "Планы и цифры");

const adminPlans = navLinksFor("admin").find((l) => l.label === "Планы и цифры")!;
check("вкладка: календарь, а не отчёт", activeSub(adminPlans.subs, "/analytics/calendar")?.label, "Календарь");
check("вкладка: отчёт", activeSub(adminPlans.subs, "/analytics")?.label, "Отчёт");
const managerClients = navLinksFor("manager").find((l) => l.label === "Клиенты")!;
check("вкладка на карточке лида — «Лиды»", activeSub(managerClients.subs, "/clients/leads/L1")?.label, "Лиды");
check("вкладка на карточке клиента — «Список»", activeSub(managerClients.subs, "/clients/C1")?.label, "Список");

// --- Поиск --------------------------------------------------------------------
const client = (p: Partial<Client> & { clientId: string; name: string }): Client =>
  ({ city: "Алматы", shopName: "", contactPerson: "", phone: "", messenger: "", clientType: "", active: true, retail: "", managerEmail: "ilyas@x.kz", ...p }) as Client;
const lead = (p: Partial<Lead> & { leadId: string; name: string }): Lead =>
  ({ city: "", contactPerson: "", phone: "", stage: "new", nextTouchAt: "", managerEmail: "", origin: "", createdByEmail: "", handedOverBy: "", ...p }) as Lead;
const order = (p: Partial<OrderWithItems> & { orderId: string }): OrderWithItems =>
  ({
    clientName: "Цветы 24", clientPhone: "", deliveryDate: "2026-10-20", status: "new", managerEmail: "ilyas@x.kz",
    managerConfirmed: true, paid: false, paidAmount: 0, totalAmount: 184000, retail: "", kind: "",
    items: [{ variety: "Jumilia", quantity: 800, shippedQuantity: 0 }],
    ...p,
  }) as unknown as OrderWithItems;

const data = {
  clients: [
    client({ clientId: "C1", name: "Цветы 24", phone: "+77010001122" }),
    client({ clientId: "C2", name: "Магнолия", city: "Караганда", phone: "+77020003344" }),
    client({ clientId: "C3", name: "Цветочник, Достык 27", retail: "almaty" }),
  ],
  orders: [order({ orderId: "ORD-260914-71YDW" }), order({ orderId: "ORD-260914-8K2PQ", clientName: "Букет Сити", clientPhone: "+77030005566" })],
  leads: [lead({ leadId: "L1", name: "Lily Flowers", phone: "+77040007788", managerEmail: "ilyas@x.kz" }), lead({ leadId: "L2", name: "Lily Shymkent", managerEmail: "emil@x.kz" })],
};
const me = { role: "manager", email: "ilyas@x.kz" };
const TODAY = "2026-10-19";
const titles = (q: string, u = me) => searchEverything(q, data, u, TODAY).map((h) => `${h.kind}:${h.title}`);

check("телефон с плюсом", titles("+7 701 000 11 22"), ["client:Цветы 24"]);
check("телефон с восьмёрки", titles("8 701 000"), ["client:Цветы 24"]);
check("телефон без кода", titles("7020003"), ["client:Магнолия"]);
check("короткий номер заявки", titles("71ydw")[0], "order:№ 71YDW · Цветы 24");
check("номер с «№» и пробелом", titles("№ 8K2PQ")[0], "order:№ 8K2PQ · Букет Сити");
check("по названию — клиент первым, потом заявка", titles("цветы 24"), ["client:Цветы 24", "order:№ 71YDW · Цветы 24"]);
check("наш магазин в поиске клиентов не показывается", titles("Цветочник"), []);
check("лид по телефону", titles("7040007788"), ["lead:Lily Flowers"]);
check("чужой лид менеджеру не виден", titles("Lily"), ["lead:Lily Flowers"]);
check("РОП видит оба лида", titles("Lily", { role: "sales_head", email: "rop@x.kz" }).length, 2);
check("зав. складом клиентов не ищет", titles("Цветы", { role: "warehouse", email: "r@x.kz" }), ["order:№ 71YDW · Цветы 24"]);
check("одна буква — пусто", titles("ц"), []);
check("этап заявки в метке", searchEverything("71ydw", data, me, TODAY)[0].pill, "Ждёт оплаты");

if (fails > 0) {
  console.log(`\nПровалено проверок: ${fails}`);
  process.exit(1);
}
console.log("\nВсе проверки прошли");
