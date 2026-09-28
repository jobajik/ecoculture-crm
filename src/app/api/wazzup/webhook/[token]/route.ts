import { NextResponse } from "next/server";
import { webhookTokenOk, downloadMedia } from "@/lib/greenApi";
import { openAiConfigured, transcribeAudio } from "@/lib/openai";
import { parseWazzupMessages, parseWazzupStatuses } from "@/lib/wazzup";
import { appendWaMessages } from "@/lib/repo/talks";
import { appendWaStatuses } from "@/lib/repo/broadcasts";
import { runBot } from "@/lib/botEngine";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Уведомления Wazzup: `https://www.crm-ecoculture.kz/api/wazzup/webhook/<токен>`.
 * Адрес прописывает `scripts/wazzup-setup.ts` (его запускает wazzup-key.bat).
 *
 * Wazzup нашему API своего заголовка с подписью не шлёт, поэтому доверяем
 * только токену в адресе (WAZZUP_WEBHOOK_TOKEN); чужой адрес — 401.
 *
 * - `{ test: true }` — Wazzup проверяет адрес при подписке: 200;
 * - `messages` — в WaMessages (к лиду и клиенту привязываются по номеру при
 *   чтении, как сообщения Green API), голосовые расшифровываются, потом бот;
 * - `statuses` — дописываются в WaStatuses, не читая таблицу (грабли 1.17).
 *
 * Wazzup ждёт ответа 30 секунд. Сбой бота вебхук не роняет — иначе повтор
 * уведомления дал бы двойные сообщения.
 */
export async function POST(request: Request, { params }: { params: { token: string } }) {
  if (!webhookTokenOk(params.token, process.env.WAZZUP_WEBHOOK_TOKEN)) {
    return NextResponse.json({ error: "bad token" }, { status: 401 });
  }
  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  if (body && typeof body === "object" && (body as { test?: unknown }).test === true) {
    return NextResponse.json({ ok: true });
  }

  const messages = parseWazzupMessages(body);
  const statuses = parseWazzupStatuses(body);

  if (openAiConfigured()) {
    for (const m of messages) {
      if (m.type !== "voice" || !m.mediaUrl || m.isEcho) continue;
      try {
        const file = await downloadMedia(m.mediaUrl);
        if (file) {
          const text = await transcribeAudio(file.data, file.mime);
          if (text) m.text = [m.text, text].filter(Boolean).join(" · ");
        }
      } catch (err) {
        console.error("wazzup voice:", err instanceof Error ? err.message : err);
      }
    }
  }

  try {
    await appendWaMessages(messages);
    await appendWaStatuses(statuses);
  } catch (err) {
    // 500 — Wazzup повторит позже; это правильно, если не ответила таблица.
    console.error("wazzup webhook:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "temporary" }, { status: 500 });
  }

  await runBot(messages);
  return NextResponse.json({ ok: true });
}
