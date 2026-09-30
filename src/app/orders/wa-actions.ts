"use server";

import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { authOptions } from "@/lib/auth";
import { guard } from "@/lib/actionResult";
import { ROLES } from "@/lib/constants";
import { listClients } from "@/lib/repo/clients";
import { closeWaOrderDraft, listWaOrderDrafts } from "@/lib/repo/waOrders";
import { visibleDrafts } from "@/lib/waOrder";

/**
 * «Скрыть» заказ из WhatsApp: не заказ, уже оформлен руками, дубль. Скрывает
 * тот, кому черновик виден (`visibleDrafts`) — чужой по прямому запросу нельзя.
 */
async function dismissWaDraftActionInner(draftId: string) {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email?.toLowerCase() ?? "";
  const role = session?.user?.role ?? "";
  if (!email) throw new Error("Не авторизован");
  if (role !== ROLES.ADMIN && role !== ROLES.MANAGER) throw new Error("Заказы из WhatsApp разбирают менеджеры");
  const [drafts, clients] = await Promise.all([listWaOrderDrafts({ fresh: true }), listClients()]);
  const mine = visibleDrafts(drafts, clients, role, email).find((x) => x.draft.draftId === draftId);
  if (!mine) throw new Error("Этот заказ уже разобран или он не ваш");
  await closeWaOrderDraft(draftId, "dismissed", email);
  revalidatePath("/orders");
  return { ok: true };
}

export async function dismissWaDraftAction(...args: Parameters<typeof dismissWaDraftActionInner>) {
  return guard(() => dismissWaDraftActionInner(...args));
}
