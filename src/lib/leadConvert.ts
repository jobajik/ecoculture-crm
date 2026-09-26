import { CLIENT_SOURCES, CLIENT_TYPES } from "./constants";
import { cleanStage, phoneKey, stageIndex } from "./leads";
import { createClient, listClients } from "./repo/clients";
import { updateLead } from "./repo/leads";
import type { Lead } from "./types";

const fromList = (value: string | undefined, list: readonly string[]) => {
  const v = (value || "").trim();
  return list.includes(v) ? v : "";
};

/**
 * Карточка клиента из лида — без неё заявку не оформить. Если клиент с тем же
 * телефоном уже есть, лид привязывается к нему, а не плодит двойника. Лид
 * встаёт на «Пробный заказ». Зовут кнопка «Завести клиентом» в карточке лида и
 * итог звонка «Договорились о заказе» на экране обзвона.
 */
export async function ensureClientForLead(
  lead: Lead,
  actorEmail: string,
  extra: { paymentTerms?: string; city?: string; paymentTermsList?: readonly string[] } = {}
): Promise<{ clientId: string; linked: boolean; lead: Lead }> {
  if (lead.clientId) return { clientId: lead.clientId, linked: true, lead };
  const city = (lead.city || extra.city || "").trim();
  if (!city) throw new Error("Укажите город — без него клиента не завести");

  const key = phoneKey(lead.phone);
  const existing = key ? (await listClients()).find((c) => phoneKey(c.phone) === key) : undefined;
  let clientId = existing?.clientId ?? "";
  if (!clientId) {
    clientId = await createClient({
      name: lead.name,
      city,
      shopName: "",
      clientType: fromList(lead.clientType, CLIENT_TYPES),
      contactPerson: lead.contactPerson,
      phone: lead.phone,
      messenger: "",
      address: lead.address,
      paymentTerms: extra.paymentTermsList ? fromList(extra.paymentTerms, extra.paymentTermsList) : "",
      source: fromList(lead.source, CLIENT_SOURCES),
      note: lead.note,
      managerEmail: lead.managerEmail || actorEmail,
      paymentMethod: "",
      kaspiPay1: "",
      kaspiPay2: "",
      retail: "",
    });
  }
  const changes: Record<string, string> = { ClientID: clientId };
  if (!lead.city.trim()) changes.City = city;
  const stage = cleanStage(lead.stage);
  if (stageIndex(stage) < stageIndex("trial") || stage === "lost") {
    changes.Stage = "trial";
    changes.StageChangedAt = new Date().toISOString();
    changes.LostReason = "";
  }
  if (!lead.managerEmail) changes.ManagerEmail = actorEmail;
  await updateLead(lead.leadId, changes);
  return {
    clientId,
    linked: !!existing,
    lead: { ...lead, clientId, city, stage: changes.Stage ?? lead.stage, managerEmail: lead.managerEmail || actorEmail },
  };
}
