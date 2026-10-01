"use server";

import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { authOptions } from "@/lib/auth";
import { guard } from "@/lib/actionResult";
import { FLOWER_TYPE_LABELS, ROLES, formatGrade } from "@/lib/constants";
import { commitAtomic } from "@/lib/sheets";
import { botPhotoUpdate, createBotPhoto, listBotPhotos } from "@/lib/repo/botPhotos";
import { CAPTION_SCHEMA, MAX_PHOTO_CAPTION, captionPrompt, parseCaption, photoRefusal } from "@/lib/botPhotos";
import { chatJson, openAiConfigured } from "@/lib/openai";

/** Фото для рассылок и бота — как и рассылки, только админ и РОП. */
async function requirePhotoEditor() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) throw new Error("Не авторизован");
  const role = session.user.role;
  if (role !== ROLES.ADMIN && role !== ROLES.SALES_HEAD) throw new Error("Фото для рассылок добавляют администратор и РОП");
  return { email: session.user.email.toLowerCase() };
}

const clean = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);

/** Подпись от ИИ по цветку — человек правит её перед сохранением. */
async function suggestCaptionActionInner(input: { flowerType: string; variety: string; grade: string }) {
  await requirePhotoEditor();
  if (!FLOWER_TYPE_LABELS[input.flowerType]) throw new Error("Выберите цветок");
  if (!openAiConfigured()) throw new Error("ИИ не подключён — напишите подпись сами");
  const what = [
    `Цветок: ${FLOWER_TYPE_LABELS[input.flowerType]}`,
    input.variety ? `Сорт: ${clean(input.variety, 60)}` : "",
    input.grade ? `Категория / длина: ${formatGrade(clean(input.grade, 40))}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  const { data } = await chatJson(captionPrompt(), what, "photo_caption", CAPTION_SCHEMA as unknown as Record<string, unknown>, { fast: true });
  const caption = parseCaption(data);
  if (!caption) throw new Error("ИИ не предложил подпись — попробуйте ещё раз или напишите сами");
  return { caption };
}

async function savePhotoActionInner(input: { fileId: string; fileName: string; flowerType: string; variety: string; grade: string; caption: string }) {
  const { email } = await requirePhotoEditor();
  const refusal = photoRefusal({ flowerType: input.flowerType, caption: input.caption, fileId: input.fileId });
  if (refusal) throw new Error(refusal);
  const photoId = await createBotPhoto({
    createdByEmail: email,
    flowerType: input.flowerType,
    variety: clean(input.variety, 60),
    grade: clean(input.grade, 40),
    caption: clean(input.caption, MAX_PHOTO_CAPTION),
    fileId: clean(input.fileId, 60),
    fileName: clean(input.fileName, 120) || "photo.jpg",
  });
  revalidatePath("/clients/broadcasts/photos");
  return { photoId };
}

/** Поправить подпись или выключить фото из ротации (удалять не нужно: выключенное просто не уходит). */
async function updatePhotoActionInner(photoId: string, changes: { caption?: string; active?: boolean }) {
  await requirePhotoEditor();
  const photo = (await listBotPhotos(true)).find((p) => p.photoId === photoId);
  if (!photo) throw new Error("Фото не найдено");
  const patch: Record<string, unknown> = {};
  if (changes.caption !== undefined) {
    if (String(changes.caption).trim().length > MAX_PHOTO_CAPTION) throw new Error(`Подпись длиннее ${MAX_PHOTO_CAPTION} знаков — сократите`);
    patch.Caption = clean(changes.caption, MAX_PHOTO_CAPTION);
  }
  if (changes.active !== undefined) patch.Active = changes.active ? "TRUE" : "FALSE";
  if (Object.keys(patch).length) await commitAtomic([botPhotoUpdate(photo.rowNumber, patch)]);
  revalidatePath("/clients/broadcasts/photos");
  return { ok: true };
}

// Обёртки: отказ ВОЗВРАЩАЕТСЯ, а не бросается (грабли 1.13).
export async function suggestCaptionAction(...args: Parameters<typeof suggestCaptionActionInner>) {
  return guard(() => suggestCaptionActionInner(...args));
}
export async function savePhotoAction(...args: Parameters<typeof savePhotoActionInner>) {
  return guard(() => savePhotoActionInner(...args));
}
export async function updatePhotoAction(...args: Parameters<typeof updatePhotoActionInner>) {
  return guard(() => updatePhotoActionInner(...args));
}
