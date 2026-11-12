/**
 * Роль «Маркетолог» (12.11.2026, Назгуль; владелец: «будет видеть переписки, продажи и оплаты»): только смотрит.
 * Проверка стережёт обе стороны: нужные разделы открыты, а всё, что пишет, отправляет или меняет, — закрыто.
 *
 * Запуск: npx tsx scripts/check-marketer.ts
 */
import { ROLES, ROLE_LABELS, ORDER_STATUSES } from "../src/lib/constants";
import { canOpen } from "../src/lib/access";
import { canEditFinance, canSeeFinance, canSeeFinanceInternals } from "../src/lib/financeAccess";
import { financeTabsFor } from "../src/app/finance/tabs";
import { salesTabsFor } from "../src/app/sales/tabs";
import { clientsTabsFor } from "../src/app/clients/tabs";
import { navLinksFor } from "../src/components/navLinks";
import { cancelRefusal, confirmRefusal } from "../src/lib/orderRules";
import { canEditOrder, editItemsRefusal } from "../src/lib/orderEdit";
import { canRepeatFrom } from "../src/lib/repeatOrder";
import { storeChangeRefusal } from "../src/lib/officeStore";
import { warehouseEditRefusal } from "../src/lib/warehouseOrderEdit";
import { newOrderLinksFor } from "../src/lib/newOrder";
import { canManageLeads, canUseLeads } from "../src/lib/leads";
import { canSearchClients } from "../src/lib/globalSearch";
import { canEditPoint } from "../src/lib/point";
import { kaspiSendRefusal } from "../src/lib/kaspiInvoice";
import { canSeeAllChats, canSendOnLeadsLine, chatsReadOnly } from "../src/lib/chatAccess";
import { visibleOrdersFor } from "../src/lib/orderVisibility";

let fails = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) fails++;
  console.log(`${ok ? "OK  " : "FAIL"} ${label}: ${JSON.stringify(actual)}${ok ? "" : ` (ждали ${JSON.stringify(expected)})`}`);
}

const M = ROLES.MARKETER;
const ME = "nazgul@x.kz";
check("роль названа по-русски", ROLE_LABELS[M], "Маркетолог");

// --- Что открыто ---------------------------------------------------------------------------
for (const p of ["/clients/chats", "/sales", "/sales/plan", "/sales/flowers", "/sales/day", "/prices", "/orders", "/orders/ABCDE", "/finance", "/finance/status", "/finance/debts", "/finance/reminders", "/finance/point", "/finance/claims", "/finance/analytics", "/finance/report"]) {
  check(`открыто: ${p}`, canOpen(M, p), true);
}

// --- Что закрыто ---------------------------------------------------------------------------
for (const p of ["/orders/new", "/clients", "/clients/ABC", "/clients/leads", "/clients/leads/decide", "/clients/leads/ads", "/clients/leads/calls", "/clients/leads/talks", "/clients/broadcasts", "/clients/analytics", "/clients/habits", "/finance/takeouts", "/finance/log", "/warehouse", "/warehouse/stock", "/warehouse/ship", "/office", "/retail", "/plans", "/plans/ai", "/forecast", "/analytics", "/analytics/month", "/payroll", "/greenhouse", "/admin"]) {
  check(`закрыто: ${p}`, canOpen(M, p), false);
}

// --- Меню ------------------------------------------------------------------------------------
const menu = navLinksFor(M);
check("разделы меню", menu.map((l) => l.label), ["Переписки", "Продажи", "Заявки", "Оплаты"]);
check("все адреса меню открыты", menu.flatMap((l) => [l.href, ...l.subs.map((s) => s.href)]).filter((h) => !canOpen(M, h.split("?")[0])), []);
check("в «Клиентах» — только переписки", clientsTabsFor(undefined, M).map((t) => t.href), ["/clients/chats"]);
check("продажи: рейтинг, план-факт, по цветам, за день, прайс", salesTabsFor(M).map((t) => t.href), ["/sales", "/sales/plan", "/sales/flowers", "/sales/day", "/prices"]);
const finHrefs = financeTabsFor(M).flatMap((t) => (t.views ? t.views.map((v) => v.href) : [t.href]));
check("оплаты: без удержаний и журнала", [finHrefs.includes("/finance/takeouts"), finHrefs.includes("/finance/log"), finHrefs.includes("/finance/debts")], [false, false, true]);
check("кнопки «новая заявка» нет", newOrderLinksFor(M), []);

// --- Деньги: видит, не трогает -----------------------------------------------------------------
check("оплаты видит", canSeeFinance(M), true);
check("оплаты НЕ меняет", canEditFinance(M), false);
check("удержания и журнал не видит", canSeeFinanceInternals(M), false);
check("выручку точки не вносит", canEditPoint(M), false);
check(
  "счёт Kaspi не выставляет",
  kaspiSendRefusal({ role: M, farmConfigured: true, farm: "esentai", invoiceFarms: [{ farm: "esentai", amount: 1000, paidAmount: 0 }], orderStatus: "new", noInvoice: false, phone: "87015552030", amount: 1000, existing: [] }),
  "Счёт в Kaspi выставляет бухгалтер"
);

// --- Заявки: видит, не трогает -----------------------------------------------------------------
const order = { orderId: "O1", status: ORDER_STATUSES.NEW, managerEmail: ME, retail: "", kind: "", store: "", direction: "", clientId: "C1", paidAmount: 0, items: [{ itemId: "I1", flowerType: "rose", variety: "Jumilia", grade: "60", quantity: 100, unitPrice: 200, shippedQuantity: 0 }] };
check("не отменяет (даже записанную на себя)", cancelRefusal(order as never, M, ME) !== "", true);
check("не правит шапку", canEditOrder(order as never, M, ME), false);
check("не правит позиции", editItemsRefusal(order as never, M, ME) !== "", true);
check("не подтверждает", confirmRefusal(order, M, ME, true) !== "", true);
check("не повторяет заявку", canRepeatFrom(order, M, ME), false);
check("не меняет склад заявки", storeChangeRefusal({ role: M, isOwner: true, order, to: "office" }) !== "", true);
check("не правит позиции как склад", warehouseEditRefusal(order as never, M, "rose_farm") !== "", true);
const seen = visibleOrdersFor([{ ...order, totalAmount: 20000 }, { ...order, orderId: "O2", retail: "almaty", totalAmount: 20000 }] as never, { role: M, email: ME });
check("видит продажи, а перемещения в наши магазины — нет", seen.map((o) => o.orderId), ["O1"]);

// --- Переписки: все номера, только чтение ------------------------------------------------------
check("видит все номера", canSeeAllChats(M), true);
check("только читает", chatsReadOnly(M), true);
check("с номера Земфиры не пишет", canSendOnLeadsLine(M), false);
check("РОП и админ по-прежнему не «только читают»", [chatsReadOnly(ROLES.SALES_HEAD), chatsReadOnly(ROLES.ADMIN), chatsReadOnly(ROLES.MANAGER)], [false, false, false]);
check("менеджер по-прежнему видит не все номера", canSeeAllChats(ROLES.MANAGER), false);

// --- Лиды и клиентская база закрыты --------------------------------------------------------------
check("лидами не пользуется", [canUseLeads(M), canManageLeads(M)], [false, false]);
check("поиск по клиентам закрыт", canSearchClients(M), false);

console.log(fails === 0 ? "\nВсе проверки прошли" : `\nПровалено проверок: ${fails}`);
process.exit(fails === 0 ? 0 : 1);
