"use server";

import { revalidatePath } from "next/cache";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { listUsers, saveUser } from "@/lib/repo/users";
import { saveSettings } from "@/lib/repo/settings";
import { ROLES } from "@/lib/constants";
import { shelfLifeRefusal, shelfLifeValues, type ShelfLifeDraft } from "@/lib/shelfLifeRules";
import { guard } from "@/lib/actionResult";
import { cleanStaff, staffChangeSummary, staffSaveRefusal, type StaffDraft } from "@/lib/staffRules";

/**
 * Сотрудники: завести, сменить роль, закрыть доступ.
 *
 * Раньше это делалось только руками во вкладке `Users` Google-таблицы, и
 * страница «Настройки» была инструкцией, как туда сходить. Принять человека на
 * работу — обычное дело, а выглядело оно как задача для программиста.
 *
 * Все запреты живут в `src/lib/staffRules.ts` и проверяются ЗДЕСЬ, на сервере,
 * а не в форме: форма — подсказка, запрещает сервер (грабли 1.11). Отказ
 * возвращается текстом через `guard()`, иначе Next.js в боевой сборке подменит
 * его на «An error occurred…», и человек не узнает, что именно не так
 * (грабли 1.13).
 */
async function saveStaffActionInner(draft: StaffDraft) {
  const session = await getServerSession(authOptions);
  const actorRole = session?.user?.role;
  const actorEmail = session?.user?.email ?? "";

  const users = await listUsers();
  const refusal = staffSaveRefusal({ actorRole, actorEmail, users }, draft);
  if (refusal) throw new Error(refusal);

  const clean = cleanStaff(draft);
  const before = users.find((u) => u.email === clean.email) ?? null;
  const { created } = await saveUser(clean);

  // Страницы, где видны роли и имена сотрудников. Роль перечитывается при
  // каждом обновлении токена, поэтому право начнёт действовать само.
  revalidatePath("/admin");
  revalidatePath("/orders");

  return {
    created,
    summary: staffChangeSummary(before, clean),
  };
}

export async function saveStaffAction(draft: StaffDraft) {
  return guard(() => saveStaffActionInner(draft));
}

/**
 * Сроки хранения. Те же правила: запрещает сервер, отказ доходит текстом.
 *
 * Раньше их правили ключами `ShelfLifeDays_rose` на вкладке `Settings`, а
 * страница объясняла, как эти ключи называются. Срок хранения — решение
 * хозяйства, а не настройка программиста.
 */
async function saveShelfLifeActionInner(draft: ShelfLifeDraft) {
  const session = await getServerSession(authOptions);
  if (session?.user?.role !== ROLES.ADMIN) {
    throw new Error("Сроки хранения меняет только администратор.");
  }

  const refusal = shelfLifeRefusal(draft);
  if (refusal) throw new Error(refusal);

  await saveSettings(shelfLifeValues(draft));
  // Срок хранения красит склад и считает запас в аналитике — обе страницы
  // обязаны показать новое число сразу, иначе владелец решит, что не сохранилось.
  revalidatePath("/admin");
  revalidatePath("/");
  revalidatePath("/analytics");
  return { saved: true };
}

export async function saveShelfLifeAction(draft: ShelfLifeDraft) {
  return guard(() => saveShelfLifeActionInner(draft));
}
