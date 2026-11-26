"use server";

import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { authOptions } from "@/lib/auth";
import { guard } from "@/lib/actionResult";
import { ROLES } from "@/lib/constants";
import { saveSettings } from "@/lib/repo/settings";
import { logMoney } from "@/lib/repo/moneyLog";
import { setOwners } from "@/lib/repo/baseOwners";
import { BASE_DECLINED_SETTING, loadBase, parseList } from "@/lib/baseRunner";
import type { BaseEntry } from "@/lib/baseClass";

const PATH = "/clients/base";

/** Чей человек, решают администратор и РОП (проверка на сервере — грабли 1.11). */
async function requireManage() {
  const session = await getServerSession(authOptions);
  const role = session?.user?.role;
  if (role !== ROLES.ADMIN && role !== ROLES.SALES_HEAD) throw new Error("Передавать людей между менеджерами могут администратор и РОП");
  return { email: (session?.user?.email || "").toLowerCase() };
}

const who = (e: BaseEntry) => e.name || (e.phone ? `…${e.phone.replace(/\D/g, "").slice(-4)}` : "без имени");

/** Записать людей за новым менеджером: и карточки, и лиды этого человека. */
async function writeOwners(list: { entry: BaseEntry; to: string }[]): Promise<number> {
  const res = await setOwners({
    clients: list.flatMap((x) => x.entry.clientIds.map((clientId) => ({ clientId, managerEmail: x.to }))),
    leads: list.flatMap((x) => x.entry.leadIds.map((leadId) => ({ leadId, managerEmail: x.to }))),
  });
  return res.clients + res.leads;
}

/**
 * Подтвердить переносы. Браузер присылает только ключи людей: кому и почему — сервер считает сам по свежим данным,
 * и переносит лишь тех, по кому предложение всё ещё в силе.
 */
async function confirmMovesActionInner(keys: string[]) {
  const me = await requireManage();
  const base = await loadBase({ fresh: true });
  const pick = new Set(keys);
  const list = base.entries.filter((e) => pick.has(e.key) && e.moveTo).map((entry) => ({ entry, to: entry.moveTo }));
  if (!list.length) throw new Error("Переносить нечего: предложения уже неактуальны — обновите страницу");
  await writeOwners(list);
  await logMoney({
    actorEmail: me.email,
    orderId: "",
    action: "base_owner",
    details: `База: подтверждён перенос ${list.length} чел. — ${list.slice(0, 25).map((x) => `${who(x.entry)}: ${base.nameOf(x.entry.owner) || "ничей"} → ${base.nameOf(x.to)}`).join("; ")}${list.length > 25 ? " …" : ""}`.slice(0, 1800),
    amountBefore: 0,
    amountAfter: 0,
  });
  revalidatePath(PATH);
  return { moved: list.length, skipped: keys.length - list.length };
}

export async function confirmMovesAction(keys: string[]) {
  return guard(() => confirmMovesActionInner(keys));
}

/** Отклонить переносы: эти пары «человек → менеджер» больше не предлагаются. */
async function declineMovesActionInner(keys: string[]) {
  await requireManage();
  const base = await loadBase({ fresh: true });
  const pick = new Set(keys);
  const add = base.entries.filter((e) => pick.has(e.key) && e.moveTo).map((e) => `${e.key}>${e.moveTo}`);
  if (!add.length) return { declined: 0 };
  const all = Array.from(new Set([...parseList(base.map[BASE_DECLINED_SETTING]), ...add])).slice(-3000);
  await saveSettings({ [BASE_DECLINED_SETTING]: JSON.stringify(all) });
  revalidatePath(PATH);
  return { declined: add.length };
}

export async function declineMovesAction(keys: string[]) {
  return guard(() => declineMovesActionInner(keys));
}

/** Раздать: записать выбранных людей за менеджером или снять с менеджера (пустая почта — «ничей»). */
async function assignActionInner(keys: string[], to: string) {
  const me = await requireManage();
  const base = await loadBase({ fresh: true });
  const target = (to || "").trim().toLowerCase();
  if (target && !base.takers.includes(target)) throw new Error("Записать можно только за работающим менеджером");
  const pick = new Set(keys);
  const list = base.entries.filter((e) => pick.has(e.key) && (e.clientIds.length || e.leadIds.length)).map((entry) => ({ entry, to: target }));
  if (!list.length) throw new Error("Никого не выбрано");
  await writeOwners(list);
  await logMoney({
    actorEmail: me.email,
    orderId: "",
    action: "base_owner",
    details: `База: ${target ? `за ${base.nameOf(target)} записано` : "снято с менеджера"} ${list.length} чел. — ${list.slice(0, 25).map((x) => `${who(x.entry)} (был ${base.nameOf(x.entry.owner) || "ничей"})`).join("; ")}${list.length > 25 ? " …" : ""}`.slice(0, 1800),
    amountBefore: 0,
    amountAfter: 0,
  });
  revalidatePath(PATH);
  return { moved: list.length };
}

export async function assignAction(keys: string[], to: string) {
  return guard(() => assignActionInner(keys, to));
}
