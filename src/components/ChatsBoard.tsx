"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { closeNoteAction, draftReplyAction, sendReplyAction } from "@/app/clients/chats/actions";
import { unwrap, unwrapValue } from "@/lib/actionResult";
import Chips from "./Chips";
import Pager, { pageSlice } from "./Pager";

/** Чатов на странице списка: столько помещается рядом с перепиской без прокрутки. */
const CHATS_PAGE = 12;

export interface BoardNote {
  at: string;
  note: string;
}
export interface BoardChat {
  phone: string;
  key: string;
  name: string;
  partyKind: "client" | "lead" | "";
  partyId: string;
  partyManager: string;
  lastAt: string;
  lastText: string;
  lastDirection: "in" | "out";
  lastByAssistant: boolean;
  waitingSince: string | null;
  notes: BoardNote[];
}
export interface BoardMessage {
  id: string;
  at: string;
  direction: "in" | "out";
  type: string;
  text: string;
  /** ai — ответил ИИ-помощник, crm — отправлено из CRM. */
  by: "ai" | "crm" | "";
}

type View = "all" | "waiting" | "notes" | "ai";

/** Время по Алматы — одинаково на сервере и в браузере (иначе страница перерисовывается целиком). */
function formatMoment(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Almaty", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
    .format(d)
    .replace(",", "");
}

function waitWords(iso: string | null): string {
  if (!iso) return "";
  const min = Math.max(0, (Date.now() - Date.parse(iso)) / 60000);
  if (min < 60) return `${Math.round(min)} мин`;
  if (min < 48 * 60) return `${Math.round(min / 60)} ч`;
  return `${Math.round(min / 1440)} дн.`;
}

function bodyOf(m: BoardMessage): string {
  if (m.type === "text") return m.text;
  if (m.type === "voice") return m.text ? `🎤 ${m.text}` : "🎤 голосовое";
  const label: Record<string, string> = { image: "фото", video: "видео", document: "файл", audio: "аудио", location: "место", contact: "контакт", sticker: "стикер" };
  return `[${label[m.type] ?? "вложение"}]${m.text ? ` ${m.text}` : ""}`;
}

export default function ChatsBoard({
  lines,
  line,
  chats,
  selected,
  thread,
  verdict,
  canSend,
  aiReady,
  lineConnected,
}: {
  lines: { code: string; label: string; waiting: number; chats: number }[];
  line: string;
  chats: BoardChat[];
  selected: BoardChat | null;
  thread: BoardMessage[];
  verdict: string;
  canSend: boolean;
  aiReady: boolean;
  lineConnected: boolean;
}) {
  const [view, setView] = useState<View>("all");
  const [q, setQ] = useState("");
  const href = (phone?: string) => `/clients/chats?line=${encodeURIComponent(line)}${phone ? `&phone=${phone}` : ""}`;
  const notesCount = chats.filter((c) => c.notes.length > 0).length;
  const shown = useMemo(() => {
    const qq = q.trim().toLowerCase();
    const digits = q.replace(/\D/g, "");
    return chats.filter((c) => {
      if (view === "waiting" && !c.waitingSince) return false;
      if (view === "notes" && c.notes.length === 0) return false;
      if (view === "ai" && !c.lastByAssistant) return false;
      if (!qq) return true;
      return c.name.toLowerCase().includes(qq) || (digits.length >= 4 && c.phone.includes(digits)) || c.lastText.toLowerCase().includes(qq);
    });
  }, [chats, view, q]);

  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [view, q, line]);
  const waitingCount = chats.filter((c) => c.waitingSince).length;
  const aiCount = chats.filter((c) => c.lastByAssistant).length;

  return (
    <div>
      {lines.length > 1 && (
        <div className="flex gap-2 overflow-x-auto scroll-x-hidden lg:flex-wrap -mx-1 px-1 mb-4">
          {lines.map((l) => (
            <Link
              key={l.code || "main"}
              href={`/clients/chats?line=${encodeURIComponent(l.code)}`}
              className={clsx(
                "flex-none h-8 px-3 rounded-full border text-[13px] whitespace-nowrap inline-flex items-center gap-1.5 transition-colors",
                l.code === line ? "bg-ink-primary border-ink-primary text-white" : "bg-surface border-line-hairline text-ink-secondary hover:text-ink-primary"
              )}
            >
              {l.label}
              {l.waiting > 0 && <b className={clsx("font-semibold tabular-nums", l.code !== line && "text-status-critical")}>{l.waiting}</b>}
            </Link>
          ))}
        </div>
      )}
      {!lineConnected && <p className="text-sm text-status-critical mb-4">У этого номера нет ключа — подключите его в «Настройках → WhatsApp менеджеров».</p>}

      <div className="grid lg:grid-cols-[360px_minmax(0,1fr)] gap-5 items-start">
        <div className={clsx("card !p-0 overflow-hidden min-w-0", selected && "hidden lg:block")}>
          <div className="px-4 py-3 space-y-2.5 border-b border-line-hairline">
            <input className="input w-full" placeholder="Поиск: имя, номер, текст" value={q} onChange={(e) => setQ(e.target.value)} />
            <Chips
              value={view}
              onChange={(v) => setView(v as View)}
              items={[
                { value: "all", label: "Все", count: chats.length },
                { value: "waiting", label: "Ждут ответа", count: waitingCount, alarm: true },
                { value: "notes", label: "Нужен менеджер", count: notesCount, alarm: true },
                { value: "ai", label: "Ответил ИИ", count: aiCount },
              ]}
            />
          </div>
          <div className="divide-y divide-line-hairline/70">
            {shown.length === 0 && <p className="px-4 py-6 text-sm text-ink-muted">Пусто.</p>}
            {pageSlice(shown, page, CHATS_PAGE).map((c) => (
              <Link key={c.key} href={href(c.phone)} className={clsx("block px-4 py-2.5 hover:bg-surface-plane", selected?.key === c.key && "bg-section-leads-soft")}>
                <div className="flex items-center gap-2">
                  <span className="font-medium truncate min-w-0 flex-1">{c.name}</span>
                  <span className="text-[11px] text-ink-muted flex-none">{formatMoment(c.lastAt)}</span>
                </div>
                <div className="flex items-center gap-1.5 mt-0.5">
                  {c.waitingSince && <span suppressHydrationWarning className="flex-none rounded bg-status-critical/10 text-status-critical px-1 text-[11px]">ждёт {waitWords(c.waitingSince)}</span>}
                  {c.notes.length > 0 && <span className="flex-none rounded bg-status-warning/15 text-[#8a5a00] px-1 text-[11px]">нужен менеджер</span>}
                  {c.lastByAssistant && !c.waitingSince && <span className="flex-none rounded bg-section-leads-soft text-section-leads px-1 text-[11px]">ИИ</span>}
                  <span className="text-xs text-ink-muted truncate min-w-0">
                    {c.lastDirection === "out" ? "Мы: " : ""}
                    {c.lastText}
                  </span>
                </div>
              </Link>
            ))}
          </div>
          <Pager total={shown.length} page={page} onPage={setPage} size={CHATS_PAGE} what="чатов" />
        </div>

        {selected ? (
          <Thread key={selected.key} line={line} chat={selected} thread={thread} verdict={verdict} canSend={canSend} aiReady={aiReady} backHref={href()} />
        ) : (
          <div className="card hidden lg:grid place-items-center min-h-[320px] text-sm text-ink-muted">Выберите переписку слева.</div>
        )}
      </div>
    </div>
  );
}

function Thread({
  line,
  chat,
  thread,
  verdict,
  canSend,
  aiReady,
  backHref,
}: {
  line: string;
  chat: BoardChat;
  thread: BoardMessage[];
  verdict: string;
  canSend: boolean;
  aiReady: boolean;
  backHref: string;
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [aiNote, setAiNote] = useState("");
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [thread.length]);
  const wa = `https://wa.me/${chat.phone}`;

  async function draft() {
    setBusy("draft");
    setMsg(null);
    try {
      const r = unwrapValue(await draftReplyAction(line, chat.phone));
      setText(r.text);
      setAiNote(r.note);
      if (r.silent && !r.text) setMsg({ ok: true, text: "ИИ считает, что здесь отвечать не нужно (кивок, автоответ или не про цветы)." });
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "Не удалось" });
    } finally {
      setBusy("");
    }
  }

  async function send() {
    setBusy("send");
    setMsg(null);
    try {
      unwrap(await sendReplyAction(line, chat.phone, text));
      setText("");
      setAiNote("");
      setMsg({ ok: true, text: "Отправлено" });
      router.refresh();
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "Не удалось" });
    } finally {
      setBusy("");
    }
  }

  async function done() {
    setBusy("done");
    try {
      unwrap(await closeNoteAction(line, chat.phone));
      router.refresh();
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "Не удалось" });
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="card !p-0 overflow-hidden">
      <div className="px-4 py-3 border-b border-line-hairline flex flex-wrap items-center gap-x-3 gap-y-1">
        <Link href={backHref} className="lg:hidden text-sm text-section-leads">
          ← Чаты
        </Link>
        <span className="font-semibold">{chat.name}</span>
        <span className="text-sm text-ink-muted tabular-nums">+{chat.phone}</span>
        {chat.partyKind === "lead" && (
          <Link href={`/clients/leads/${chat.partyId}`} className="text-sm text-section-leads hover:underline">
            лид{chat.partyManager ? ` · ${chat.partyManager}` : ""} →
          </Link>
        )}
        {chat.partyKind === "client" && (
          <Link href={`/clients/${chat.partyId}`} className="text-sm text-section-client hover:underline">
            клиент{chat.partyManager ? ` · ${chat.partyManager}` : ""} →
          </Link>
        )}
        {!chat.partyKind && <span className="text-xs text-ink-muted">нет ни в лидах, ни в клиентах</span>}
        <a href={wa} target="_blank" rel="noreferrer" className="ml-auto text-sm text-status-good font-medium">
          WhatsApp ↗
        </a>
      </div>
      {chat.notes.length > 0 && (
        <div className="px-4 py-2 bg-status-warning/10 text-sm flex flex-wrap items-start gap-2">
          <div className="flex-1 min-w-0">
            {chat.notes.map((n, i) => (
              <div key={i}>
                <span className="text-ink-muted">{formatMoment(n.at)} · ИИ просит:</span> {n.note}
              </div>
            ))}
          </div>
          <button type="button" className="btn-secondary !py-1 text-sm" onClick={done} disabled={!!busy}>
            Сделано
          </button>
        </div>
      )}
      <div className="max-h-[60vh] overflow-y-auto px-4 py-3 space-y-2 bg-surface-plane">
        {thread.map((m) => (
          <div key={m.id} className={clsx("flex", m.direction === "out" ? "justify-end" : "justify-start")}>
            <div
              className={clsx(
                "max-w-[85%] rounded-xl px-3 py-2 text-sm whitespace-pre-line break-words",
                m.direction === "out" ? (m.by === "ai" ? "bg-section-leads-soft" : "bg-[#dcf8c6]") : "bg-surface border border-line-hairline"
              )}
            >
              {bodyOf(m)}
              <div className="text-[10px] text-ink-muted text-right mt-0.5">
                {m.by === "ai" ? "ИИ · " : m.by === "crm" ? "из CRM · " : ""}
                {formatMoment(m.at)}
              </div>
            </div>
          </div>
        ))}
        <div ref={bottom} />
      </div>
      <div className="px-4 py-3 border-t border-line-hairline space-y-2">
        {verdict && <p className="text-xs text-ink-muted">{verdict}</p>}
        <textarea
          className="input w-full min-h-[90px]"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={canSend ? "Сообщение клиенту" : "Черновик — скопируйте или откройте в WhatsApp"}
        />
        {aiNote && <p className="text-xs text-[#8a5a00]">ИИ советует менеджеру: {aiNote}</p>}
        <div className="flex flex-wrap items-center gap-2">
          {aiReady && (
            <button type="button" className="btn-secondary !py-1.5 text-sm" onClick={draft} disabled={!!busy}>
              {busy === "draft" ? "ИИ пишет…" : "Предложить ответ (ИИ)"}
            </button>
          )}
          {canSend && (
            <button type="button" className="btn-primary !py-1.5 text-sm" onClick={send} disabled={!!busy || !text.trim()}>
              {busy === "send" ? "Отправляю…" : "Отправить"}
            </button>
          )}
          {text.trim() && (
            <a href={`${wa}?text=${encodeURIComponent(text.trim())}`} target="_blank" rel="noreferrer" className="text-sm text-status-good">
              Открыть в WhatsApp с этим текстом
            </a>
          )}
          {msg && <span className={clsx("text-sm", msg.ok ? "text-status-good" : "text-status-critical")}>{msg.text}</span>}
        </div>
      </div>
    </div>
  );
}
