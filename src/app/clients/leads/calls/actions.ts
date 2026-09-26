"use server";

import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { authOptions } from "@/lib/auth";
import { guard } from "@/lib/actionResult";
import { ROLES } from "@/lib/constants";
import { localDayKey } from "@/lib/timezone";
import { canManageLeads, canUseLeads, canWorkLead, cleanStage, dealEvenly, isClosedStage, leadChangesAfterTouch, touchRefusal } from "@/lib/leads";
import { noAnswerCount, planCall, type CallInput } from "@/lib/calls";
import { addTouch, findLeadRow, listLeadTouches, listLeads, reassignLeads } from "@/lib/repo/leads";
import { listUsers } from "@/lib/repo/users";
import { ensureClientForLead } from "@/lib/leadConvert";

/**
 * Экран «Обзвон»: итог звонка одним нажатием и раздача базы. Все запреты —
 * здесь, на сервере (грабли 1.11); правила — чистые функции в `src/lib/calls.ts`.
 */
async function requireLeads() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) throw new Error("Не авторизован");
  const role = session.user.role;
  if (!canUseLeads(role)) throw new Error("Обзвоном занимаются менеджеры и РОП");
  return { email: session.user.email.trim().toLowerCase(), role, manage: canManageLeads(role) };
}

const CALLS_PATH = "/clients/leads/calls";

/**
 * Записать итог звонка. «Договорились о заказе» сначала заводит карточку
 * клиента (без неё заявку не оформить), потом пишет касание.
 */
async function recordCallActionInner(leadId: string, input: CallInput & { city?: string }) {
  const { email, role } = await requireLeads();
  const found = await findLeadRow(leadId);
  if (!found) throw new Error("Лид не найден — возможно, его удалили в таблице");
  let lead = found.lead;
  if (!canWorkLead(role, email, lead)) {
    throw new Error(lead.managerEmail ? "Это клиент другого менеджера" : "Сначала возьмите клиента себе");
  }
  if (isClosedStage(cleanStage(lead.stage))) throw new Error("По этому клиенту обзвон уже закрыт");

  const today = localDayKey();
  const touches = (await listLeadTouches({ fresh: true })).filter((t) => t.leadId === leadId);
  const clean: CallInput = {
    outcome: String(input.outcome ?? "").trim(),
    comment: String(input.comment ?? "").trim(),
    date: String(input.date ?? "").trim(),
    reason: String(input.reason ?? "").trim(),
  };

  let clientId = "";
  if (clean.outcome === "order" && !lead.clientId) {
    const res = await ensureClientForLead(lead, email, { city: String(input.city ?? "").trim().slice(0, 80) });
    lead = res.lead;
    clientId = res.clientId;
  }

  const plan = planCall(clean, lead, noAnswerCount(touches), today);
  if (typeof plan === "string") throw new Error(plan);
  const refusal = touchRefusal(plan.touch, lead, today);
  if (refusal) throw new Error(refusal);

  const now = new Date().toISOString();
  await addTouch(
    leadId,
    {
      managerEmail: email,
      channel: plan.touch.channel,
      comment: plan.touch.comment,
      stageFrom: cleanStage(lead.stage),
      stageTo: plan.touch.stage,
      nextTouchAt: plan.touch.nextTouchAt,
      outcome: plan.outcome,
    },
    leadChangesAfterTouch(lead, plan.touch, now),
    now,
    found.rowNumber
  );
  // Страницу не перерисовываем: очередь двигает сам экран обзвона, а каждое
  // перечитывание — это вся база из Google (грабли 1.17). Страницы динамические
  // и при переходе всё равно читаются заново.
  return { ok: true, closed: plan.closed, clientId: clientId || lead.clientId, nextTouchAt: plan.touch.nextTouchAt };
}

/**
 * Раздать поровну и случайно: ничьих из обзвона или ещё не тронутых у одного
 * менеджера (ушёл, в отпуске) — между отмеченными. Тронутые не перекладываются:
 * у них уже есть разговор и договорённость.
 */
async function distributeLeadsActionInner(input: { campaign: string; from: string; to: string[] }) {
  const { manage } = await requireLeads();
  if (!manage) throw new Error("Раздаёт базу РОП");
  const users = await listUsers();
  const sellers = new Set(
    users.filter((u) => u.active && (u.role === ROLES.MANAGER || u.role === ROLES.SALES_HEAD)).map((u) => u.email.toLowerCase())
  );
  const team = Array.from(new Set((input.to ?? []).map((e) => String(e).trim().toLowerCase()).filter(Boolean)));
  if (team.length === 0) throw new Error("Отметьте, кому раздать");
  for (const e of team) if (!sellers.has(e)) throw new Error("В списке есть неизвестный менеджер");
  const from = String(input.from ?? "").trim().toLowerCase();
  const campaign = String(input.campaign ?? "").trim();

  const [leads, touches] = await Promise.all([listLeads({ fresh: true }), listLeadTouches()]);
  const touched = new Set(touches.map((t) => t.leadId));
  const pool = leads.filter(
    (l) =>
      (!campaign || l.campaign === campaign) &&
      l.managerEmail === from &&
      !isClosedStage(cleanStage(l.stage)) &&
      !touched.has(l.leadId) &&
      !team.includes(l.managerEmail)
  );
  if (pool.length === 0) throw new Error(from ? "У этого менеджера нет нетронутых клиентов в обзвоне" : "Ничьих клиентов в обзвоне нет");
  const dealt = dealEvenly(pool, team, (l) => l.pastOrders > 0);
  const moved = await reassignLeads(
    pool.map((l) => ({ leadId: l.leadId, managerEmail: dealt.get(l) ?? "" })).filter((a) => a.managerEmail),
    (l) => l.managerEmail === from
  );
  revalidatePath(CALLS_PATH);
  revalidatePath("/clients/leads");
  return { moved };
}

// Обёртки: отказ ВОЗВРАЩАЕТСЯ, а не бросается (грабли 1.13).
export async function recordCallAction(...args: Parameters<typeof recordCallActionInner>) {
  return guard(() => recordCallActionInner(...args));
}
export async function distributeLeadsAction(...args: Parameters<typeof distributeLeadsActionInner>) {
  return guard(() => distributeLeadsActionInner(...args));
}
