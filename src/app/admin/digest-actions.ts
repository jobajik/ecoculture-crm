"use server";

import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { authOptions } from "@/lib/auth";
import { guard } from "@/lib/actionResult";
import { ROLES } from "@/lib/constants";
import { saveSettings } from "@/lib/repo/settings";
import { waPhone } from "@/lib/broadcast";
import { DIGEST_SETTING, digestPhones } from "@/lib/morningDigest";
import { buildMorningDigest, digestResultText, recordDigestRun, sendMorningDigest } from "@/lib/morningDigestRunner";
import { BOT_SALES_SETTING, notifyBotSale } from "@/lib/botSalesAlert";

/** Утренняя сводка в WhatsApp — настраивает только администратор. */
async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (session?.user?.role !== ROLES.ADMIN) throw new Error("Сводку настраивает администратор");
}

async function saveDigestPhonesActionInner(raw: string) {
  await requireAdmin();
  const list = digestPhones(raw);
  const bad = list.filter((p) => !waPhone(p));
  if (bad.length) throw new Error(`Не похоже на мобильный номер: ${bad.join(", ")}`);
  if (list.length > 5) throw new Error("Не больше пяти номеров");
  await saveSettings({ [DIGEST_SETTING]: list.map((p) => `+${waPhone(p)}`).join(", ") });
  revalidatePath("/admin");
  return { ok: true, count: list.length };
}

async function previewDigestActionInner() {
  await requireAdmin();
  return { text: await buildMorningDigest() };
}

async function sendDigestNowActionInner() {
  await requireAdmin();
  const r = await sendMorningDigest();
  await recordDigestRun("кнопка", digestResultText(r));
  revalidatePath("/admin");
  if (r.sent.length === 0) throw new Error(r.note || "Не отправилось");
  return { sent: r.sent.length, note: r.note };
}

export async function saveDigestPhonesAction(...args: Parameters<typeof saveDigestPhonesActionInner>) {
  return guard(() => saveDigestPhonesActionInner(...args));
}
export async function previewDigestAction() {
  return guard(() => previewDigestActionInner());
}
export async function sendDigestNowAction() {
  return guard(() => sendDigestNowActionInner());
}

/** Кому сообщать о продажах бота (Руслан, владелец, Данияр — 03.10.2026). */
async function saveBotSalesPhonesActionInner(raw: string) {
  await requireAdmin();
  const list = digestPhones(raw);
  const bad = list.filter((p) => !waPhone(p));
  if (bad.length) throw new Error(`Не похоже на мобильный номер: ${bad.join(", ")}`);
  if (list.length > 5) throw new Error("Не больше пяти номеров");
  await saveSettings({ [BOT_SALES_SETTING]: list.map((p) => `+${waPhone(p)}`).join(", ") });
  revalidatePath("/admin");
  return { ok: true, count: list.length };
}

async function testBotSalesActionInner() {
  await requireAdmin();
  const sent = await notifyBotSale("Проверка CRM: сюда будут приходить продажи бота — заказ и оплата.");
  if (sent === 0) throw new Error("Не отправилось — сохраните номера и проверьте, что WhatsApp подключён");
  return { sent };
}

export async function saveBotSalesPhonesAction(...args: Parameters<typeof saveBotSalesPhonesActionInner>) {
  return guard(() => saveBotSalesPhonesActionInner(...args));
}
export async function testBotSalesAction() {
  return guard(() => testBotSalesActionInner());
}
