/*
 * Номер менеджера: сырые ответы Green API — история одного чата (тип, отправитель), настройки, и
 * (с --set) повторная запись адреса уведомлений с ответом как есть. Токены не печатает.
 * Запуск: npx tsx scripts/diag-line-probe.ts <код линии> <цифры чата> [--set]
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { listWaLines, managerLineConfig } from "../src/lib/repo/waLines";

async function main() {
  const [code, tail] = process.argv.slice(2);
  const doSet = process.argv.includes("--set");
  const line = (await listWaLines({ fresh: true })).find((l) => l.code === code);
  const cfg = managerLineConfig(line);
  if (!line || !cfg) throw new Error("нет линии или ключа");
  const hide = (s: string) => s.split(cfg.token).join("***").split(process.env.WHATSAPP_WEBHOOK_TOKEN || "§§§").join("<token>");
  const call = async (method: string, body?: unknown) => {
    const res = await fetch(`${cfg.url}/waInstance${cfg.instance}/${method}/${cfg.token}`, {
      method: body === undefined ? "GET" : "POST",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });
    return { status: res.status, text: hide(await res.text()) };
  };
  console.log("getStateInstance:", (await call("getStateInstance")).text);
  const s = await call("getSettings");
  console.log("getSettings:", s.status, s.text.slice(0, 1500));
  if (tail) {
    const chats = JSON.parse((await call("getChats")).text) as { id: string }[];
    const chat = chats.find((c) => c.id.replace(/@.*/, "").endsWith(tail));
    console.log("чат:", chat ? "…" + chat.id.slice(-9) : "не найден");
    if (chat) {
      const h = await call("getChatHistory", { chatId: chat.id, count: 12 });
      const items = JSON.parse(h.text) as Record<string, unknown>[];
      for (const it of items)
        console.log(
          [it.type, it.typeMessage, `sender=${String(it.senderId || "").slice(-9)}`, `byApi=${it.sendByApi}`, `status=${it.statusMessage}`, String(it.textMessage || it.caption || "").slice(0, 60)].join(" | ")
        );
    }
  }
  if (doSet) {
    const hook = `https://www.crm-ecoculture.kz/api/whatsapp/webhook?line=${encodeURIComponent(code)}`;
    const r = await call("setSettings", {
      webhookUrl: hook,
      webhookUrlToken: (process.env.WHATSAPP_WEBHOOK_TOKEN || "").trim(),
      incomingWebhook: "yes",
      outgoingMessageWebhook: "yes",
      outgoingAPIMessageWebhook: "yes",
      outgoingWebhook: "yes",
      stateWebhook: "no",
      incomingCallWebhook: "no",
      pollMessageWebhook: "no",
      markIncomingMessagesReaded: "no",
    });
    console.log("setSettings:", r.status, r.text.slice(0, 500));
    for (const wait of [5, 30, 60]) {
      await new Promise((ok) => setTimeout(ok, wait * 1000));
      const again = await call("getSettings");
      const o = JSON.parse(again.text) as Record<string, unknown>;
      console.log(`через ${wait} с: webhookUrl=${o.webhookUrl ? "есть" : "ПУСТО"} incoming=${o.incomingWebhook}`);
    }
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
