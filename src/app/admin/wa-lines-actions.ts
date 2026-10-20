"use server";

import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { authOptions } from "@/lib/auth";
import { guard } from "@/lib/actionResult";
import { ROLES } from "@/lib/constants";
import { getInstancePhone, getInstanceState, getQrCode, greenConfig, greenLeadsConfig } from "@/lib/greenApi";
import { pullLineHistory, setupLine } from "@/lib/leadsLineSetup";
import { sealSecret } from "@/lib/secretBox";
import { listUsers } from "@/lib/repo/users";
import { listWaLines, managerLineConfig, saveWaLine, updateWaLine } from "@/lib/repo/waLines";
import { LEADS_ASSISTANT_SETTING, lineCodeFor, lineInputRefusal, parseAssistantMode, parseLeadsAssistantMode, type AssistantMode, type WaLine } from "@/lib/waLines";
import { saveSettings } from "@/lib/repo/settings";

/**
 * «Настройки → WhatsApp менеджеров» (16.10.2026). Подключает номера только администратор: ключ даёт
 * полный доступ к WhatsApp менеджера. Токен в браузер не возвращается никогда — только «есть / нет».
 */
async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (session?.user?.role !== ROLES.ADMIN) throw new Error("Номера подключает администратор");
}

function site(): string {
  return (process.env.NEXTAUTH_URL || "https://www.crm-ecoculture.kz").replace(/\/+$/, "");
}

function refresh() {
  revalidatePath("/admin");
  revalidatePath("/clients/chats");
}

async function lineByCode(code: string): Promise<WaLine> {
  const line = (await listWaLines({ fresh: true })).find((l) => l.code === code);
  if (!line) throw new Error("Номер не найден — обновите страницу");
  return line;
}

/** Состояние и номер телефона — в строку номера. */
async function refreshState(line: WaLine): Promise<{ state: string; phone: string }> {
  const cfg = managerLineConfig(line);
  if (!cfg) return { state: "nokey", phone: line.phone };
  const state = await getInstanceState(cfg).catch(() => "unknown");
  const phone = state === "authorized" ? await getInstancePhone(cfg).catch(() => line.phone) : line.phone;
  await updateWaLine(line.code, { State: state, StateAt: new Date().toISOString(), Phone: phone || line.phone });
  return { state, phone: phone || line.phone };
}

async function saveWaLineActionInner(input: { managerEmail: string; instance: string; token: string; url: string; label?: string }) {
  await requireAdmin();
  const managerEmail = String(input.managerEmail || "").trim().toLowerCase();
  const instance = String(input.instance || "").trim();
  const token = String(input.token || "").trim();
  const url = String(input.url || "").trim().replace(/\/+$/, "") || "https://api.green-api.com";
  const users = await listUsers();
  const user = users.find((u) => u.email.toLowerCase() === managerEmail && u.active);
  if (!user) throw new Error("Такого сотрудника нет среди активных");
  const lines = await listWaLines({ fresh: true });
  const existing = lines.find((l) => l.managerEmail === managerEmail);
  const refusal = lineInputRefusal({ managerEmail, instance, token, url }, !!existing && !token);
  if (refusal) throw new Error(refusal);
  // Тот же инстанс уже занят: основным номером, Земфирой или другим менеджером.
  if (instance === greenConfig()?.instance) throw new Error("Это idInstance основного номера (с ботом) — для менеджера нужен свой");
  if (instance === greenLeadsConfig()?.instance) throw new Error("Это idInstance номера Земфиры — для менеджера нужен свой");
  const other = lines.find((l) => l.instance === instance && l.managerEmail !== managerEmail);
  if (other) throw new Error(`Этот idInstance уже подключён для ${other.label || other.managerEmail}`);

  const now = new Date().toISOString();
  const line: WaLine = {
    code: existing?.code ?? lineCodeFor(managerEmail, lines.map((l) => l.code)),
    managerEmail,
    label: String(input.label || "").trim() || user.name || managerEmail,
    url,
    instance,
    tokenEnc: token ? sealSecret(token) : existing?.tokenEnc ?? "",
    active: true,
    assistant: existing?.assistant ?? "on",
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    phone: existing?.instance === instance ? existing.phone : "",
    state: "",
    stateAt: "",
  };
  await saveWaLine(line);
  const cfg = managerLineConfig(line);
  if (!cfg) throw new Error("Ключ не сохранился — попробуйте ещё раз");
  let log: string[];
  try {
    log = await setupLine(cfg, line.code, site(), 3);
  } catch (err) {
    log = [`Green API не ответил: ${err instanceof Error ? err.message : String(err)}. Проверьте idInstance, токен и apiUrl.`];
  }
  const st = await refreshState(line).catch(() => ({ state: "unknown", phone: "" }));
  refresh();
  return { code: line.code, state: st.state, log };
}

async function checkWaLineActionInner(code: string) {
  await requireAdmin();
  const line = await lineByCode(code);
  const st = await refreshState(line);
  let qr = "";
  let qrNote = "";
  const cfg = managerLineConfig(line);
  if (cfg && st.state !== "authorized") {
    try {
      const r = await getQrCode(cfg);
      if (r.type === "qrCode") qr = r.message;
      else qrNote = r.type === "alreadyLogged" ? "Номер уже привязан" : r.message || "QR-код сейчас недоступен — попробуйте через минуту";
    } catch (err) {
      qrNote = err instanceof Error ? err.message : "QR-код недоступен";
    }
  }
  refresh();
  return { state: st.state, phone: st.phone, qr, qrNote };
}

/** После привязки по QR: адрес уведомлений ещё раз (перепривязка его стирает) и переписка за 3 дня. */
async function connectWaLineActionInner(code: string) {
  await requireAdmin();
  const line = await lineByCode(code);
  const cfg = managerLineConfig(line);
  if (!cfg) throw new Error("Нет ключа — подключите номер заново");
  const log = await setupLine(cfg, line.code, site(), 3);
  const st = await refreshState(line);
  refresh();
  return { state: st.state, log };
}

async function pullWaLineHistoryActionInner(code: string, offset: number) {
  await requireAdmin();
  const line = await lineByCode(code);
  const cfg = managerLineConfig(line);
  if (!cfg) throw new Error("Нет ключа — подключите номер заново");
  const log = await pullLineHistory(cfg, line.code, 40000, Math.max(0, Math.floor(Number(offset) || 0)));
  const next = log.map((x) => /offset=(\d+)/.exec(x)?.[1]).find(Boolean);
  refresh();
  return { log: log.map((x) => x.replace(/ — откройте с &offset=\d+\./, ".")), nextOffset: next ? Number(next) : null };
}

async function setWaLineModeActionInner(code: string, input: { assistant?: string; active?: boolean }) {
  await requireAdmin();
  await lineByCode(code);
  const changes: Record<string, string> = { UpdatedAt: new Date().toISOString() };
  if (input.assistant !== undefined) changes.Assistant = parseAssistantMode(input.assistant) as AssistantMode;
  if (input.active !== undefined) changes.Active = input.active ? "TRUE" : "FALSE";
  await updateWaLine(code, changes);
  refresh();
  return { ok: true };
}

/**
 * Режим помощника на номере Земфиры (20.10.2026, владелец: «или автоматом, чтобы сам ИИ отправлял» — выбрал «подсказывает и
 * отвечает при молчании»). Строки в `WaLines` у её номера нет — режим хранится настройкой `LeadsAssistant`.
 */
async function setLeadsAssistantModeActionInner(mode: string) {
  await requireAdmin();
  if (!greenLeadsConfig()) throw new Error("Номер Земфиры не подключён (ключи GREENAPI_LEADS_* не заданы)");
  await saveSettings({ [LEADS_ASSISTANT_SETTING]: parseLeadsAssistantMode(mode) });
  refresh();
  return { ok: true };
}

export async function setLeadsAssistantModeAction(...args: Parameters<typeof setLeadsAssistantModeActionInner>) {
  return guard(() => setLeadsAssistantModeActionInner(...args));
}
export async function saveWaLineAction(...args: Parameters<typeof saveWaLineActionInner>) {
  return guard(() => saveWaLineActionInner(...args));
}
export async function checkWaLineAction(...args: Parameters<typeof checkWaLineActionInner>) {
  return guard(() => checkWaLineActionInner(...args));
}
export async function connectWaLineAction(...args: Parameters<typeof connectWaLineActionInner>) {
  return guard(() => connectWaLineActionInner(...args));
}
export async function pullWaLineHistoryAction(...args: Parameters<typeof pullWaLineHistoryActionInner>) {
  return guard(() => pullWaLineHistoryActionInner(...args));
}
export async function setWaLineModeAction(...args: Parameters<typeof setWaLineModeActionInner>) {
  return guard(() => setWaLineModeActionInner(...args));
}
