"use server";

import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { authOptions } from "@/lib/auth";
import { guard } from "@/lib/actionResult";
import { ROLES } from "@/lib/constants";
import { saveSettings } from "@/lib/repo/settings";
import { settingsMap } from "@/lib/repo/broadcasts";
import { AUTO_RULES, AUTO_SETTING, autoConfigValue, parseAutoConfig, type AutoRule } from "@/lib/autoBroadcast";
import { cancelTodayAuto, kickBroadcast, planAutoBroadcasts } from "@/lib/autoBroadcastRunner";
import { SITE } from "@/lib/broadcastSend";

/** Автопилот рассылок — админ и РОП, как и рассылки (проверка на сервере — грабли 1.11). */
async function requireBroadcaster() {
  const session = await getServerSession(authOptions);
  const role = session?.user?.role;
  if (role !== ROLES.ADMIN && role !== ROLES.SALES_HEAD) throw new Error("Автопилот рассылок — у администратора и РОПа");
  return { email: (session?.user?.email || "").toLowerCase(), name: session?.user?.name || session?.user?.email || "" };
}

const PATH = "/clients/broadcasts/auto";

async function setRuleActionInner(rule: string, on: boolean) {
  await requireBroadcaster();
  if (!AUTO_RULES.includes(rule as AutoRule)) throw new Error("Такого правила нет");
  const cfg = parseAutoConfig((await settingsMap(true))[AUTO_SETTING]);
  cfg.rules[rule as AutoRule] = !!on;
  await saveSettings({ [AUTO_SETTING]: autoConfigValue(cfg) });
  revalidatePath(PATH);
}

export async function setRuleAction(rule: string, on: boolean) {
  return guard(() => setRuleActionInner(rule, on));
}

async function stopTodayActionInner() {
  const me = await requireBroadcaster();
  const n = await cancelTodayAuto(me.name);
  revalidatePath(PATH);
  revalidatePath("/clients/broadcasts");
  return n;
}

export async function stopTodayAction() {
  return guard(() => stopTodayActionInner());
}

/** Собрать (или пересобрать) план сейчас — без письма в WhatsApp: человек и так смотрит на страницу. */
async function planNowActionInner() {
  await requireBroadcaster();
  const r = await planAutoBroadcasts({ force: true, notify: false });
  revalidatePath(PATH);
  revalidatePath("/clients/broadcasts");
  // Если уже пора — цепочка запустит план сама.
  await kickBroadcast(SITE());
  return { messages: r.messages, activateAt: r.plan.activateAt };
}

export async function planNowAction() {
  return guard(() => planNowActionInner());
}
