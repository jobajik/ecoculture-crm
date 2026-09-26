// ---------------------------------------------------------------------------
// OpenAI — расшифровка голосовых и разбор переписки. Один ключ на всё — так
// решил владелец. Ключ OPENAI_API_KEY он вводит сам (`whatsapp-key.bat`),
// в коде и в журналах его нет.
//
// Модель не зашита намертво: названия у OpenAI меняются, и программа пробует
// список по порядку (сначала OPENAI_MODEL, если задан), запоминая первую, что
// ответила. Так смена линейки моделей не превращается в поломку разбора.
// ---------------------------------------------------------------------------

const BASE = () => (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");

export function openAiKey(): string {
  return (process.env.OPENAI_API_KEY || "").trim();
}

export function openAiConfigured(): boolean {
  return openAiKey().length > 0;
}

const TEXT_MODELS = () =>
  [process.env.OPENAI_MODEL, "gpt-5-mini", "gpt-4.1-mini", "gpt-4o-mini"].filter((m): m is string => !!m && !!m.trim());
const TRANSCRIBE_MODELS = () =>
  [process.env.OPENAI_TRANSCRIBE_MODEL, "gpt-4o-mini-transcribe", "gpt-4o-transcribe", "whisper-1"].filter(
    (m): m is string => !!m && !!m.trim()
  );

let chosenText: string | null = null;
let chosenTranscribe: string | null = null;

class ModelUnavailable extends Error {}

/** Ответ OpenAI → текст ошибки по-русски, без ключа. */
async function failure(res: Response, what: string): Promise<Error> {
  let code = "";
  let message = "";
  try {
    const body = (await res.json()) as { error?: { code?: string; message?: string; type?: string } };
    code = String(body?.error?.code || body?.error?.type || "");
    message = String(body?.error?.message || "");
  } catch {
    /* пустое тело */
  }
  if (res.status === 404 || ["model_not_found", "unsupported_parameter", "unsupported_value"].includes(code)) {
    return new ModelUnavailable(message || code);
  }
  if (res.status === 401) return new Error("OpenAI не принял ключ — проверьте OPENAI_API_KEY (whatsapp-key.bat).");
  if (res.status === 429 && code === "insufficient_quota") {
    return new Error("На счёте OpenAI закончились деньги — пополните баланс на platform.openai.com.");
  }
  if (res.status === 429) return new Error("OpenAI просит подождать (много запросов) — повторите через минуту.");
  const key = openAiKey();
  const clean = (message || code || `ошибка ${res.status}`).split(key).join("***");
  return new Error(`${what}: ${clean.slice(0, 200)}`);
}

async function withModels<T>(
  models: string[],
  remembered: string | null,
  remember: (m: string) => void,
  run: (model: string) => Promise<T>
): Promise<T> {
  const order = remembered ? [remembered, ...models.filter((m) => m !== remembered)] : models;
  let last: Error | null = null;
  for (const model of order) {
    try {
      const out = await run(model);
      remember(model);
      return out;
    } catch (err) {
      if (err instanceof ModelUnavailable) {
        last = err;
        continue;
      }
      throw err;
    }
  }
  throw new Error(`OpenAI: ни одна модель из списка не доступна (${last?.message ?? ""})`.slice(0, 240));
}

/** Расшифровка голосового. Язык не задаём: говорят и по-русски, и по-казахски. */
export async function transcribeAudio(data: ArrayBuffer, mime: string): Promise<string> {
  const key = openAiKey();
  if (!key) throw new Error("OpenAI не подключён");
  const ext = /mpeg|mp3/.test(mime) ? "mp3" : /mp4|m4a|aac/.test(mime) ? "m4a" : /wav/.test(mime) ? "wav" : "ogg";
  return withModels(
    TRANSCRIBE_MODELS(),
    chosenTranscribe,
    (m) => (chosenTranscribe = m),
    async (model) => {
      const form = new FormData();
      form.append("file", new Blob([data], { type: mime || "audio/ogg" }), `voice.${ext}`);
      form.append("model", model);
      form.append("prompt", "Разговор с клиентом о цветах: розы, хризантемы, эустома, стебли, длина, прайс, доставка.");
      const res = await fetch(`${BASE()}/audio/transcriptions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}` },
        body: form,
        signal: AbortSignal.timeout(45000),
      });
      if (!res.ok) throw await failure(res, "Расшифровка");
      const body = (await res.json()) as { text?: string };
      return String(body?.text || "").trim();
    }
  );
}

/**
 * Запрос к модели с ответом строго по JSON-схеме. Возвращает разобранный
 * объект и имя модели, которая ответила (оно пишется в разбор).
 */
export async function chatJson(
  system: string,
  user: string,
  schemaName: string,
  schema: Record<string, unknown>
): Promise<{ data: unknown; model: string }> {
  const key = openAiKey();
  if (!key) throw new Error("OpenAI не подключён — владелец вводит ключ в whatsapp-key.bat.");
  let usedModel = "";
  const data = await withModels(
    TEXT_MODELS(),
    chosenText,
    (m) => (chosenText = m),
    async (model) => {
      const res = await fetch(`${BASE()}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          response_format: { type: "json_schema", json_schema: { name: schemaName, strict: true, schema } },
        }),
        signal: AbortSignal.timeout(50000),
      });
      if (!res.ok) throw await failure(res, "Разбор");
      const body = (await res.json()) as { choices?: { message?: { content?: string; refusal?: string } }[] };
      const msg = body?.choices?.[0]?.message;
      if (msg?.refusal) throw new Error(`Модель отказалась разбирать: ${msg.refusal.slice(0, 160)}`);
      const content = String(msg?.content || "");
      usedModel = model;
      try {
        return JSON.parse(content);
      } catch {
        throw new Error("Модель вернула не то, что просили, — повторите разбор.");
      }
    }
  );
  return { data, model: usedModel };
}
