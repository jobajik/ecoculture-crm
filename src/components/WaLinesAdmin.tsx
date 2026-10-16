"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { unwrap, unwrapValue } from "@/lib/actionResult";
import {
  checkWaLineAction,
  connectWaLineAction,
  pullWaLineHistoryAction,
  saveWaLineAction,
  setWaLineModeAction,
} from "@/app/admin/wa-lines-actions";
import { formatMoment } from "@/lib/formatDate";

export interface WaLineRow {
  code: string;
  managerEmail: string;
  managerName: string;
  label: string;
  phone: string;
  state: string;
  stateAt: string;
  active: boolean;
  assistant: "on" | "off";
  hasKey: boolean;
  messages: number;
}

const ASSISTANT_MODE_LABELS = { on: "подсказывает и отвечает, когда менеджер молчит", off: "только подсказывает" };

const STATE_TEXT: Record<string, { text: string; tone: string }> = {
  authorized: { text: "подключён", tone: "bg-status-good/10 text-status-good" },
  notAuthorized: { text: "нужен QR-код", tone: "bg-status-warning/15 text-[#8a5a00]" },
  starting: { text: "запускается", tone: "bg-surface-sunk text-ink-secondary" },
  yellowCard: { text: "ограничен WhatsApp", tone: "bg-status-critical/10 text-status-critical" },
  blocked: { text: "заблокирован", tone: "bg-status-critical/10 text-status-critical" },
  nokey: { text: "нет ключа", tone: "bg-status-critical/10 text-status-critical" },
};

function prettyPhone(d: string): string {
  return d.length === 11 ? `+${d[0]} ${d.slice(1, 4)} ${d.slice(4, 7)} ${d.slice(7, 9)} ${d.slice(9)}` : d ? `+${d}` : "—";
}

export default function WaLinesAdmin({ lines, managers }: { lines: WaLineRow[]; managers: { email: string; name: string }[] }) {
  const router = useRouter();
  const [form, setForm] = useState({ managerEmail: "", instance: "", token: "", url: "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; lines: string[] } | null>(null);

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const r = unwrapValue(await saveWaLineAction(form));
      setMsg({ ok: true, lines: [r.state === "authorized" ? "Номер подключён." : "Ключ сохранён. Теперь нажмите «QR-код» у этого номера и отсканируйте его телефоном менеджера.", ...r.log] });
      setForm({ managerEmail: "", instance: "", token: "", url: "" });
      router.refresh();
    } catch (err) {
      setMsg({ ok: false, lines: [err instanceof Error ? err.message : "Не удалось"] });
    } finally {
      setBusy(false);
    }
  }

  const taken = new Set(lines.map((l) => l.managerEmail));
  return (
    <div className="space-y-4">
      {lines.length > 0 ? (
        <div className="divide-y divide-line-hairline border border-line-hairline rounded-lg">
          {lines.map((l) => (
            <LineRow key={l.code} line={l} />
          ))}
        </div>
      ) : (
        <p className="text-sm text-ink-muted">Номеров менеджеров пока нет.</p>
      )}

      <details className="border border-line-hairline rounded-lg p-3" open={lines.length === 0}>
        <summary className="cursor-pointer font-medium">+ Подключить номер менеджера</summary>
        <ol className="mt-3 mb-3 text-sm text-ink-secondary list-decimal pl-5 space-y-1">
          <li>В кабинете Green API создайте инстанс (тариф «Бизнес», если с номера будут рассылки).</li>
          <li>Скопируйте из карточки инстанса idInstance, apiTokenInstance и apiUrl и вставьте ниже.</li>
          <li>Нажмите «Подключить», потом «QR-код» — менеджер сканирует его в WhatsApp: Настройки → Связанные устройства.</li>
        </ol>
        <div className="grid sm:grid-cols-2 gap-3">
          <label className="text-sm">
            <span className="block text-ink-secondary mb-1">Менеджер</span>
            <select className="input w-full" value={form.managerEmail} onChange={(e) => setForm({ ...form, managerEmail: e.target.value })}>
              <option value="">— выберите —</option>
              {managers.map((m) => (
                <option key={m.email} value={m.email}>
                  {m.name || m.email}
                  {taken.has(m.email) ? " (заменить ключ)" : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="block text-ink-secondary mb-1">idInstance</span>
            <input className="input w-full" inputMode="numeric" value={form.instance} onChange={(e) => setForm({ ...form, instance: e.target.value.replace(/\D/g, "") })} placeholder="1103123456" />
          </label>
          <label className="text-sm">
            <span className="block text-ink-secondary mb-1">apiTokenInstance</span>
            <input className="input w-full" type="password" autoComplete="off" value={form.token} onChange={(e) => setForm({ ...form, token: e.target.value.trim() })} placeholder="вставьте токен" />
          </label>
          <label className="text-sm">
            <span className="block text-ink-secondary mb-1">apiUrl</span>
            <input className="input w-full" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value.trim() })} placeholder="https://1103.api.green-api.com" />
          </label>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button type="button" className="btn-primary" onClick={save} disabled={busy || !form.managerEmail || !form.instance}>
            {busy ? "Подключаю…" : "Подключить"}
          </button>
          <span className="text-xs text-ink-muted">Токен хранится зашифрованным и на экран больше не выводится.</span>
        </div>
      </details>
      {msg && (
        <div className={clsx("text-sm rounded-lg px-3 py-2", msg.ok ? "bg-status-good/10" : "bg-status-critical/10 text-status-critical")}>
          {msg.lines.map((x, i) => (
            <div key={i}>{x}</div>
          ))}
        </div>
      )}
    </div>
  );
}

function LineRow({ line: l }: { line: WaLineRow }) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [qr, setQr] = useState("");
  const [log, setLog] = useState<{ ok: boolean; lines: string[] } | null>(null);
  const [offset, setOffset] = useState<number | null>(0);
  const st = STATE_TEXT[l.state] ?? { text: l.state || "не проверяли", tone: "bg-surface-sunk text-ink-secondary" };

  async function run(name: string, fn: () => Promise<unknown>) {
    setBusy(name);
    setLog(null);
    try {
      await fn();
      router.refresh();
    } catch (err) {
      setLog({ ok: false, lines: [err instanceof Error ? err.message : "Не удалось"] });
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="p-3 space-y-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-semibold">{l.managerName || l.label}</span>
        <span className="text-sm tabular-nums text-ink-secondary">{prettyPhone(l.phone)}</span>
        <span className={clsx("rounded px-1.5 py-0.5 text-[11px]", st.tone)}>{st.text}</span>
        {!l.active && <span className="rounded px-1.5 py-0.5 text-[11px] bg-surface-sunk text-ink-muted">выключен</span>}
        <span className="text-xs text-ink-muted">сообщений в CRM: {l.messages}</span>
        {l.stateAt && <span suppressHydrationWarning className="text-xs text-ink-muted">проверен {formatMoment(l.stateAt)}</span>}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <select
          className="input !py-1 !min-h-0 w-full sm:w-auto max-w-full"
          value={l.assistant}
          disabled={!!busy}
          onChange={(e) => run("mode", async () => unwrap(await setWaLineModeAction(l.code, { assistant: e.target.value })))}
        >
          <option value="on">ИИ: {ASSISTANT_MODE_LABELS.on}</option>
          <option value="off">ИИ: {ASSISTANT_MODE_LABELS.off}</option>
        </select>
        <button
          type="button"
          className="btn-secondary !py-1 text-sm"
          disabled={!!busy}
          onClick={() =>
            run("check", async () => {
              const r = unwrapValue(await checkWaLineAction(l.code));
              setQr(r.qr);
              setLog({ ok: r.state === "authorized", lines: [r.state === "authorized" ? "Номер в сети." : r.qr ? "Отсканируйте QR-код телефоном менеджера, потом нажмите «Готово, отсканировал»." : r.qrNote || `Состояние: ${r.state}`] });
            })
          }
        >
          {busy === "check" ? "Проверяю…" : l.state === "authorized" ? "Проверить" : "QR-код"}
        </button>
        <button
          type="button"
          className="btn-secondary !py-1 text-sm"
          disabled={!!busy}
          onClick={() =>
            run("connect", async () => {
              const r = unwrapValue(await connectWaLineAction(l.code));
              setQr("");
              setLog({ ok: r.state === "authorized", lines: r.log });
            })
          }
        >
          {busy === "connect" ? "…" : l.state === "authorized" ? "Обновить подключение" : "Готово, отсканировал"}
        </button>
        <button
          type="button"
          className="btn-secondary !py-1 text-sm"
          disabled={!!busy || offset === null}
          onClick={() =>
            run("history", async () => {
              const r = unwrapValue(await pullWaLineHistoryAction(l.code, offset ?? 0));
              setOffset(r.nextOffset);
              setLog({ ok: true, lines: [...r.log, r.nextOffset !== null ? "Нажмите ещё раз — подтяну следующие чаты." : "История подтянута."] });
            })
          }
        >
          {busy === "history" ? "Подтягиваю…" : "Подтянуть переписку"}
        </button>
        <button
          type="button"
          className="btn-secondary !py-1 text-sm"
          disabled={!!busy}
          onClick={() => run("active", async () => unwrap(await setWaLineModeAction(l.code, { active: !l.active })))}
        >
          {l.active ? "Выключить" : "Включить"}
        </button>
      </div>
      {qr && (
        <div className="flex items-start gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`data:image/png;base64,${qr}`} alt="QR-код WhatsApp" className="w-56 h-56 border border-line-hairline rounded" />
          <p className="text-sm text-ink-secondary max-w-xs">
            Телефон менеджера: WhatsApp → Настройки → Связанные устройства → Привязка устройства. Код живёт около 20 секунд — если не успели, нажмите «QR-код» ещё раз.
          </p>
        </div>
      )}
      {log && (
        <div className={clsx("text-sm rounded-lg px-3 py-2", log.ok ? "bg-status-good/10" : "bg-surface-plane")}>
          {log.lines.map((x, i) => (
            <div key={i}>{x}</div>
          ))}
        </div>
      )}
    </div>
  );
}
