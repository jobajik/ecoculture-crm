/*
 * «Свой город» — что видит менеджер, посаженный в город (22.11.2026, владелец: «каждый регион должен видеть остатки
 * только свои, соответственно продажи, заявки и всё остальное»).
 *
 * Стережём обе стороны. Пропустим лишнее — менеджер Астаны увидит заявки, клиентов и выручку Караганды и Алматы.
 * Закроем лишнее — он не увидит собственного клиента из другого города или свою заявку, а обычный менеджер, РОП,
 * бухгалтер и склад потеряют то, что видели всегда.
 *
 * Запуск: npx tsx scripts/check-city-scope.ts
 */
import { cityLookup, cityScopeOf, clientInScope, closedForCity, leadInScope, orderInScope } from "../src/lib/cityScope";
import { CITY_CLOSED, CITY_STORE_CODES, canOpen, cityClosedPath, isCitySeat } from "../src/lib/access";
import { REGION_STORES } from "../src/lib/officeStore";
import { visibleOrdersFor } from "../src/lib/orderVisibility";
import { canSeeLead } from "../src/lib/leads";
import { navLinksFor } from "../src/components/navLinks";
import { clientsTabsFor } from "../src/app/clients/tabs";
import { salesTabsFor } from "../src/app/sales/tabs";
import { ownLeaderboard, type LeaderboardSnapshot } from "../src/lib/leaderboard";
import { searchEverything } from "../src/lib/globalSearch";
import type { OrderWithItems } from "../src/lib/types";

let fails = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) fails++;
  console.log(`${ok ? "OK  " : "FAIL"} ${label}: ${JSON.stringify(actual)}${ok ? "" : ` (ждали ${JSON.stringify(expected)})`}`);
}

const astana = { role: "manager", email: "saltanat@x.kz", store: "astana" };
const krg = { role: "manager", email: "arman@x.kz", store: "karaganda" };
const almaty = { role: "manager", email: "ilyas@x.kz", store: "" };

console.log("\n— Кто ограничен городом —");
check("менеджер, посаженный в город", [cityScopeOf(astana), cityScopeOf(krg)], ["astana", "karaganda"]);
check("менеджер без города, РОП, админ, бухгалтер, склад — не ограничены", [almaty, { role: "sales_head", store: "astana" }, { role: "admin", store: "astana" }, { role: "accountant" }, { role: "warehouse", store: "karaganda" }, null].map((u) => cityScopeOf(u)), ["", "", "", "", "", ""]);
check("офис и мусор в складе — не город", [cityScopeOf({ role: "manager", store: "office" }), cityScopeOf({ role: "manager", store: "moscow" })], ["", ""]);
check("список городов в access.ts совпадает с REGION_STORES", [...CITY_STORE_CODES].sort(), REGION_STORES.map((r) => r.code as string).sort());
check("посадка по пропуску", [isCitySeat("manager", "astana"), isCitySeat("manager", " ASTANA "), isCitySeat("manager", ""), isCitySeat("sales_head", "astana"), isCitySeat("manager", "office")], [true, true, false, false, false]);

console.log("\n— Клиенты —");
const clients = [
  { clientId: "C1", name: "Астана Флора", city: "Астана", managerEmail: "saltanat@x.kz" },
  { clientId: "C2", name: "Магнолия", city: "г. Астана", managerEmail: "emil@x.kz" },
  { clientId: "C3", name: "Караганда Флора", city: "Караганда", managerEmail: "arman@x.kz" },
  { clientId: "C4", name: "Гортензия", city: "Алматы", managerEmail: "ilyas@x.kz" },
  { clientId: "C5", name: "Свой в Алматы", city: "Алматы", managerEmail: "Saltanat@X.kz" },
  { clientId: "C6", name: "Без города", city: "", managerEmail: "emil@x.kz" },
];
const seen = (u: typeof astana) => clients.filter((c) => clientInScope(c, cityScopeOf(u), u.email)).map((c) => c.clientId);
check("менеджер Астаны: свои и клиенты Астаны (в том числе чужого менеджера)", seen(astana), ["C1", "C2", "C5"]);
check("менеджер Караганды: только Караганда", seen(krg), ["C3"]);
check("менеджер без города — вся база, как раньше", seen(almaty), ["C1", "C2", "C3", "C4", "C5", "C6"]);

console.log("\n— Заявки —");
const O = (orderId: string, p: Partial<OrderWithItems>): OrderWithItems =>
  ({ orderId, managerEmail: "ilyas@x.kz", clientId: "", store: "", direction: "", kind: "", retail: "", status: "new", totalAmount: 1000, paidAmount: 0, items: [{ itemId: `${orderId}-1`, flowerType: "rose", variety: "Jana", grade: "60", quantity: 10, unitPrice: 100, shippedQuantity: 0 }], ...p }) as OrderWithItems;
const orders = [
  O("A-own", { managerEmail: "saltanat@x.kz", clientId: "C5" }),
  O("A-store", { managerEmail: "bot", clientId: "C4", store: "astana" }),
  O("A-client", { managerEmail: "emil@x.kz", clientId: "C2" }),
  O("A-dir", { managerEmail: "emil@x.kz", clientId: "C6", direction: "Астана" }),
  O("K-store", { managerEmail: "arman@x.kz", clientId: "C3", store: "karaganda" }),
  O("ALM", { managerEmail: "ilyas@x.kz", clientId: "C4" }),
  O("A-truck", { managerEmail: "saltanat@x.kz", kind: "region", direction: "Астана" }),
  O("SHOP", { managerEmail: "nina@x.kz", retail: "regions", clientId: "C1" }),
];
const cityOf = cityLookup(clients);
const ids = (u: { role: string; email: string; store?: string }) => visibleOrdersFor(orders, u, cityOf).map((o) => o.orderId);
check("менеджер Астаны: своя, со склада города, клиенту из города, с направлением в город", ids(astana), ["A-own", "A-store", "A-client", "A-dir"]);
check("менеджер Караганды: только Караганда", ids(krg), ["K-store"]);
check("менеджер без города — все клиентские, как раньше", ids(almaty), ["A-own", "A-store", "A-client", "A-dir", "K-store", "ALM"]);
check("РОП и админ — всё", [ids({ role: "sales_head", email: "nina@x.kz" }).length, ids({ role: "admin", email: "o@x.kz", store: "astana" }).length], [8, 8]);
check("бухгалтер — как раньше (без розницы)", ids({ role: "accountant", email: "y@x.kz" }).length, 7);
check("без городов клиентов менеджер города видит меньше, а не больше", visibleOrdersFor(orders, astana).map((o) => o.orderId), ["A-own", "A-store", "A-dir"]);
check("одна заявка: чужая — нет, своя — да", [orderInScope(orders[5], "astana", astana.email, cityOf), orderInScope(orders[0], "astana", astana.email, cityOf), orderInScope(orders[4], "astana", astana.email, cityOf)], [false, true, false]);
check("заказ на фуру своего города открывается, чужого — нет", [orderInScope(orders[6], "astana", "x@x.kz", cityOf), orderInScope(orders[6], "karaganda", "x@x.kz", cityOf)], [true, false]);

console.log("\n— Лиды —");
const leads = [
  { leadId: "L1", managerEmail: "saltanat@x.kz", city: "Алматы" },
  { leadId: "L2", managerEmail: "", city: "Астана" },
  { leadId: "L3", managerEmail: "", city: "Караганда" },
  { leadId: "L4", managerEmail: "", city: "" },
  { leadId: "L5", managerEmail: "emil@x.kz", city: "Астана" },
];
const lseen = (u: typeof astana) => leads.filter((l) => canSeeLead(u.role, u.email, l, u.store)).map((l) => l.leadId);
check("менеджер Астаны: свои и ничьи из Астаны", lseen(astana), ["L1", "L2"]);
check("менеджер Караганды: ничьи из Караганды", lseen(krg), ["L3"]);
check("менеджер без города: свои и все ничьи, как раньше", lseen(almaty), ["L2", "L3", "L4"]);
check("чужой лид своего города не виден — как и раньше", leadInScope(leads[4], "astana", astana.email), false);
check("РОП видит всех", leads.filter((l) => canSeeLead("sales_head", "nina@x.kz", l, "astana")).length, 5);

console.log("\n— Закрытые страницы —");
const closed = ["/analytics", "/analytics/calendar", "/analytics?period=2026-11", "/warehouse/stock", "/clients/analytics", "/clients/broadcasts/new", "/sales/plan", "/sales/flowers", "/sales/day"];
const open = ["/", "/orders", "/orders/new", "/orders/ORD-1", "/clients", "/clients/C1", "/clients/leads", "/clients/chats", "/clients/habits", "/sales", "/prices", "/region/astana", "/region/astana/truck/new", "/warehouse/ship/ORD-1", "/finance/claims"];
check("общие страницы хозяйства закрыты менеджеру города", closed.map((p) => canOpen("manager", p, "astana")), closed.map(() => false));
check("…и открыты менеджеру без города, как раньше", closed.map((p) => canOpen("manager", p, "")), closed.map(() => true));
check("свои страницы менеджеру города открыты", open.map((p) => canOpen("manager", p, "astana")), open.map(() => true));
check("«/sales» открыта, «/salesx» — не «/sales/plan»", [cityClosedPath("/sales"), cityClosedPath("/sales/planner"), cityClosedPath("/sales/plan")], [false, false, true]);
check("РОПу и админу город в пропуске ничего не закрывает", [canOpen("sales_head", "/analytics", "astana"), canOpen("admin", "/warehouse/stock", "astana")], [true, true]);
check("зав. складом остатки открыты", canOpen("warehouse", "/warehouse/stock", ""), true);
check("closedForCity — по человеку", [closedForCity(astana, "/analytics"), closedForCity(almaty, "/analytics"), closedForCity(astana, "/orders")], [true, false, false]);
check("список закрытого — только общие страницы", CITY_CLOSED, ["/analytics", "/warehouse/stock", "/clients/analytics", "/clients/broadcasts", "/sales/plan", "/sales/flowers", "/sales/day"]);

console.log("\n— Меню —");
const hrefs = (links: ReturnType<typeof navLinksFor>) => links.flatMap((l) => [l.href, ...l.subs.flatMap((s) => [s.href, ...(((s as { views?: { href: string }[] }).views ?? []).map((v) => v.href))])]);
const cityMenu = hrefs(navLinksFor("manager", undefined, undefined, undefined, "astana", true));
check("в меню менеджера города нет закрытых страниц", cityMenu.filter((h) => cityClosedPath(h)), []);
check("в меню есть заявки, клиенты, свой город, продажи и прайс", ["/orders", "/clients", "/region/astana", "/sales", "/prices"].map((h) => cityMenu.includes(h)), [true, true, true, true, true]);
check("в меню нет чужого города", cityMenu.filter((h) => h.startsWith("/region/") && !h.startsWith("/region/astana")), []);
const plainMenu = hrefs(navLinksFor("manager"));
check("у менеджера без города меню прежнее", ["/analytics", "/warehouse/stock", "/sales/plan", "/clients/analytics"].map((h) => plainMenu.some((x) => x.startsWith(h))), [true, true, true, true]);
check("вкладки клиентов: у города без аналитики", [clientsTabsFor(undefined, "manager", true).flatMap((t) => [t.href, ...(t.views ?? []).map((v) => v.href)]).includes("/clients/analytics"), clientsTabsFor(undefined, "manager").flatMap((t) => (t.views ?? []).map((v) => v.href)).includes("/clients/analytics")], [false, true]);
check("вкладки продаж: у города — свои продажи и прайс", salesTabsFor("manager", true).map((t) => t.href), ["/sales", "/prices"]);
check("…а флаг города у РОПа ничего не меняет", salesTabsFor("sales_head", true).length, salesTabsFor("sales_head").length);

console.log("\n— Рейтинг —");
const row = (managerEmail: string, paid: number) => ({ rank: 0, managerEmail, name: managerEmail, paidAmount: paid, totalAmount: paid + 100, pendingAmount: 100, paidStems: 1, orders: 2, paidOrders: 1, paidByFlowerType: {}, bonusByFlowerType: {}, bonus: paid / 100, pendingBonus: 1, pointAmount: 0, targetAmount: 0, progressPercent: 0, avgOrder: 0 });
const board = { generatedAt: "", period: "month", periodLabel: "", from: "", to: "", hasPlans: false, rows: [row("ilyas@x.kz", 900000), row("Saltanat@x.kz", 200000)], totals: { paidAmount: 1100000, totalAmount: 1100200, pendingAmount: 200, bonus: 11000, orders: 4, targetAmount: 0 }, rates: [] } as unknown as LeaderboardSnapshot;
const own = ownLeaderboard(board, "saltanat@x.kz");
check("менеджер города видит одну строку — свою", own.rows.map((r) => [r.managerEmail, r.rank]), [["Saltanat@x.kz", 1]]);
check("итоги — по его строке, не по компании", [own.totals.paidAmount, own.totals.totalAmount, own.totals.bonus, own.totals.orders], [200000, 200100, 2000, 2]);
check("ещё не продавал — пусто, а не чужие цифры", [ownLeaderboard(board, "new@x.kz").rows.length, ownLeaderboard(board, "new@x.kz").totals.paidAmount], [0, 0]);

console.log("\n— Поиск —");
const sClients = clients.map((c) => ({ ...c, active: true, retail: "", shopName: "", contactPerson: "", phone: "", messenger: "", clientType: "" }));
const sOrders = orders.map((o) => ({ ...o, clientName: clients.find((c) => c.clientId === o.clientId)?.name ?? "", clientPhone: "", deliveryDate: "2026-11-23" }));
const found = (u: typeof astana, q: string) =>
  searchEverything(q, { clients: sClients as never, orders: visibleOrdersFor(sOrders as never, u, cityOf), leads: [] }, u, "2026-11-22").map((h) => `${h.kind}:${h.title}`);
check("менеджер Астаны не находит клиента Караганды", found(astana, "Караганда Флора"), []);
check("…и клиента Алматы", found(astana, "Гортензия").filter((h) => h.startsWith("client")), []);
check("своего клиента находит", found(astana, "Астана Флора").some((h) => h.startsWith("client:Астана Флора")), true);
check("менеджер без города находит всех, как раньше", found(almaty, "Караганда Флора").some((h) => h.startsWith("client")), true);

console.log(fails === 0 ? "\nВсе проверки прошли" : `\nПровалено: ${fails}`);
process.exit(fails === 0 ? 0 : 1);
