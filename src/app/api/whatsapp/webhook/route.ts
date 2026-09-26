import { NextResponse } from "next/server";
import { downloadMedia, webhookTokenOk } from "@/lib/greenApi";
import { openAiConfigured, transcribeAudio } from "@/lib/openai";
import { parseGreenWebhook } from "@/lib/whatsapp";
import { appendWaMessages } from "@/lib/repo/talks";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Уведомления Green API о сообщениях рабочего WhatsApp:
 * `https://www.crm-ecoculture.kz/api/whatsapp/webhook`. Адрес и токен
 * прописывает `scripts/whatsapp-setup.ts` (его запускает whatsapp-key.bat).
 *
 * Входа тут нет, поэтому доверяем только ТОКЕНУ (`Authorization: Bearer …`,
 * WHATSAPP_WEBHOOK_TOKEN); без него — 401 и ничего не пишется. Всё, что не
 * сообщение из личного чата (статусы, группы, реакции), — 200 без записи, иначе
 * Green API повторял бы уведомление сутки.
 *
 * Таблицу вебхук НЕ читает: лимит Google общий на всю компанию (грабли 1.17), а
 * к лиду сообщение привязывается при чтении, по номеру. Голосовое расшифровывается
 * сразу: ссылка на файл у Green API живёт не вечно.
 */
export async function POST(request: Request) {
  if (!webhookTokenOk(request.headers.get("authorization"), process.env.WHATSAPP_WEBHOOK_TOKEN)) {
    return NextResponse.json({ error: "bad token" }, { status: 401 });
  }

  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  const message = parseGreenWebhook(body);
  if (!message) return NextResponse.json({ ok: true, ignored: true });

  if (message.type === "voice" && message.mediaUrl && openAiConfigured()) {
    try {
      const file = await downloadMedia(message.mediaUrl);
      if (file) {
        const text = await transcribeAudio(file.data, file.mime);
        if (text) message.text = [message.text, text].filter(Boolean).join(" · ");
      }
    } catch (err) {
      // Не расшифровалось — сообщение всё равно сохраняем: разбор попробует ещё раз.
      console.error("whatsapp voice:", err instanceof Error ? err.message : err);
    }
  }

  try {
    await appendWaMessages([message]);
    return NextResponse.json({ ok: true });
  } catch (err) {
    // 500 — Green API повторит позже; это правильно, если не ответила таблица.
    console.error("whatsapp webhook:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "temporary" }, { status: 500 });
  }
}
