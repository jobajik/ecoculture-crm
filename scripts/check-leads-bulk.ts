/**
 * Доска лидов и массовые действия (`leadsBulk.ts`, 21.10.2026): с какого номера писать, кому писать нельзя,
 * массовая смена стадии по правилам одиночного касания.
 *
 *   npx tsx scripts/check-leads-bulk.ts
 */
import { BOARD_STAGES, BULK_AI_MAX, BULK_MAX, bulkName, bulkSendRefusal, lineTitle, pickSendLine, planBulkStage } from "../src/lib/leadsBulk";
import type { Lead } from "../src/lib/types";

let failed = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "✓" : "✗"} ${name}${ok ? "" : `\n    ждали: ${JSON.stringify(expected)}\n    вышло: ${JSON.stringify(actual)}`}`);
}

const lead = (id: string, extra: Partial<Lead> = {}): Lead =>
  ({ leadId: id, name: `Лид ${id}`, contactPerson: "", phone: `+7701000000${id.slice(-1)}`, managerEmail: "z@x", stage: "contact", nextTouchAt: "2026-10-15", clientId: "", origin: "", handedOverAt: "", ...extra }) as Lead;

// --- Колонки доски
check("колонки — открытые стадии", BOARD_STAGES, ["new", "contact", "need", "offer", "trial"]);
check("пределы", [BULK_MAX >= 30, BULK_AI_MAX <= BULK_MAX], [true, true]);

// --- С какого номера
const lineOk = (l: string) => ["", "leads", "m-ilyas"].includes(l);
const facts = (line: string) => ({ lastAt: "2026-10-10T10:00:00Z", lastDirection: "out" as const, line, lastInAt: "", lastInText: "" });
const mlines = new Map([["ilyas@x", "m-ilyas"]]);
check("где шла переписка — оттуда", pickSendLine({ facts: facts("m-ilyas"), lead: lead("1"), role: "leadgen", managerLines: mlines, lineOk }), "m-ilyas");
check("переписка на рабочем номере — рабочий", pickSendLine({ facts: facts(""), lead: lead("1"), role: "leadgen", managerLines: mlines, lineOk }), "");
check("Земфира, переписки нет — её номер", pickSendLine({ facts: undefined, lead: lead("1"), role: "leadgen", managerLines: mlines, lineOk }), "leads");
check("менеджер со своим номером — свой", pickSendLine({ facts: undefined, lead: lead("1", { managerEmail: "ilyas@x" }), role: "manager", managerLines: mlines, lineOk }), "m-ilyas");
check("менеджер без номера, лид с рекламы — номер Земфиры", pickSendLine({ facts: undefined, lead: lead("1", { managerEmail: "emil@x", origin: "ads" }), role: "manager", managerLines: mlines, lineOk }), "leads");
check("менеджер без номера, обычный лид — рабочий", pickSendLine({ facts: undefined, lead: lead("1", { managerEmail: "emil@x" }), role: "manager", managerLines: mlines, lineOk }), "");
check("переписка на отключённом номере — не он", pickSendLine({ facts: facts("m-off"), lead: lead("1", { managerEmail: "ilyas@x" }), role: "manager", managerLines: mlines, lineOk }), "m-ilyas");
check("ничего не подключено — none", pickSendLine({ facts: undefined, lead: lead("1"), role: "manager", managerLines: new Map(), lineOk: () => false }), "none");

// --- Кому нельзя
const ctx = { staff: new Set(["7010000009"]), optedOut: new Set(["7010000008"]), lineOk };
check("можно", bulkSendRefusal(lead("1"), "77010000001", "leads", ctx), "");
check("без номера", bulkSendRefusal(lead("1", { phone: "" }), "", "leads", ctx), "нет мобильного номера");
check("сотрудник", bulkSendRefusal(lead("9"), "77010000009", "leads", ctx), "это наш сотрудник");
check("отписался", bulkSendRefusal(lead("8"), "77010000008", "leads", ctx), "отписался от рассылок");
check("закрыт", bulkSendRefusal(lead("1", { stage: "lost" }), "77010000001", "leads", ctx), "лид закрыт");
check("номер не подключён", bulkSendRefusal(lead("1"), "77010000001", "none", ctx), "номер для отправки не подключён");
check("подпись номера", [lineTitle("leads", ""), lineTitle("m-ilyas", "Ильяса"), lineTitle("", "")], ["номер Земфиры", "номер Ильяса", "рабочий номер"]);
check("имя для отчёта", bulkName(lead("1")), "Лид 1 (…0001)");

// --- Массовая стадия
const addDays = (d: string, n: number) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};
const leads = [
  lead("1"),
  lead("2", { managerEmail: "other@x" }), // чужой
  lead("3", { stage: "offer" }), // уже там
  lead("4", { clientId: "" }), // на пробный без карточки — нельзя
  lead("5", { managerEmail: "" }), // ничей
];
const r1 = planBulkStage(leads, { stage: "offer", lostReason: "", nextTouchAt: "", comment: "" }, { email: "z@x", role: "manager" }, "2026-10-21", () => 0, addDays);
check("стадия: кому можно", r1.plan.map((p) => p.leadId), ["1", "4"]);
check("стадия: касание — «Другое», дата послезавтра, комментарий по умолчанию", [r1.plan[0].input.channel, r1.plan[0].input.nextTouchAt, r1.plan[0].input.comment], ["Другое", "2026-10-23", "Перенесён на доске лидов"]);
check("стадия: почему нет", r1.refused.map((r) => `${r.lead.leadId}: ${r.why}`), ["2: лид другого менеджера", "3: уже на этой стадии", "5: ничей — сначала возьмите себе"]);
const r2 = planBulkStage([lead("4")], { stage: "trial", lostReason: "", nextTouchAt: "", comment: "" }, { email: "z@x", role: "manager" }, "2026-10-21", () => 0, addDays);
check("пробный без карточки — отказ правилом касания", r2.refused[0]?.why.startsWith("Сначала заведите лида клиентом"), true);
const r3 = planBulkStage([lead("1"), lead("6", { origin: "ads", handedOverAt: "2026-10-15T10:00:00Z" })], { stage: "lost", lostReason: "Дорого", nextTouchAt: "", comment: "" }, { email: "z@x", role: "sales_head" }, "2026-10-21", () => 0, addDays);
check("отказ: причина в касании, переданному с рекламы до двух касаний — нельзя", [r3.plan.map((p) => p.leadId), r3.plan[0].input.lostReason, r3.plan[0].input.comment, r3.refused.length], [["1"], "Дорого", "Отказ: Дорого", 1]);
const r4 = planBulkStage([lead("1")], { stage: "lost", lostReason: "", nextTouchAt: "", comment: "" }, { email: "z@x", role: "manager" }, "2026-10-21", () => 0, addDays);
check("отказ без причины — нельзя", r4.refused[0]?.why, "Укажите причину отказа");
const r5 = planBulkStage([lead("1")], { stage: "need", lostReason: "", nextTouchAt: "2026-10-01", comment: "позвонили" }, { email: "z@x", role: "manager" }, "2026-10-21", () => 0, addDays);
check("дата в прошлом — нельзя", r5.refused[0]?.why, "Следующее касание не может быть в прошлом");
const r6 = planBulkStage([lead("1"), lead("2", { managerEmail: "other@x" })], { stage: "need", lostReason: "", nextTouchAt: "2026-10-25", comment: "позвонили" }, { email: "rop@x", role: "sales_head" }, "2026-10-21", () => 0, addDays);
check("РОП двигает любые", r6.plan.map((p) => p.leadId), ["1", "2"]);

console.log(failed === 0 ? "\nВсе проверки прошли." : `\nПровалено: ${failed}`);
process.exit(failed === 0 ? 0 : 1);
