"use client";

import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useCallback, useEffect, useRef, useState } from "react";
import clsx from "clsx";
import Icon, { type IconName } from "./Icon";
import Pill from "./Pill";
import { unwrap } from "@/lib/actionResult";
import { searchAction } from "@/app/search-actions";
import { SEARCH_MIN_LENGTH, type SearchHit } from "@/lib/globalSearch";

/**
 * Общий поиск по сайту (19.10.2026, макет принят владельцем): Ctrl K или кнопка в шапке — окно с одним полем, в
 * котором ищутся клиенты, заявки и лиды сразу. Стрелки — выбрать, Enter — открыть, Esc — закрыть. Живёт один на
 * весь сайт (подключён в `layout.tsx`); кнопки открывают его событием `crm:search`.
 */
export const OPEN_SEARCH_EVENT = "crm:search";

export function openSearch() {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(OPEN_SEARCH_EVENT));
}

const KIND: Record<SearchHit["kind"], { icon: IconName; label: string; cls: string }> = {
  client: { icon: "client", label: "Клиент", cls: "bg-section-client-soft text-section-client" },
  order: { icon: "order", label: "Заявка", cls: "bg-accent-soft text-accent" },
  lead: { icon: "phone", label: "Лид", cls: "bg-section-leads-soft text-section-leads" },
};

export default function CommandPalette() {
  const { data: session } = useSession();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const seq = useRef(0);

  const close = useCallback(() => setOpen(false), []);

  // Открытие: Ctrl K / ⌘K где угодно и событие от кнопок в шапке.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_SEARCH_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_SEARCH_EVENT, onOpen);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => inputRef.current?.focus(), 20);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      clearTimeout(t);
      document.body.style.overflow = previous;
    };
  }, [open]);

  // Поиск — с задержкой 250 мс после последней буквы; ответ на устаревший запрос отбрасывается.
  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (q.length < SEARCH_MIN_LENGTH) {
      setHits([]);
      setBusy(false);
      return;
    }
    const my = ++seq.current;
    setBusy(true);
    const t = setTimeout(async () => {
      try {
        const result = unwrap(await searchAction(q));
        if (my !== seq.current) return;
        setHits(result);
        setCursor(0);
        setError("");
      } catch (e) {
        if (my !== seq.current) return;
        setError(e instanceof Error ? e.message : "Поиск не ответил");
      } finally {
        if (my === seq.current) setBusy(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [query, open]);

  const go = (hit: SearchHit) => {
    setOpen(false);
    router.push(hit.href);
  };

  if (!session || !open) return null;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") close();
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(hits.length - 1, c + 1));
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(0, c - 1));
    }
    if (e.key === "Enter" && hits[cursor]) go(hits[cursor]);
  };

  const short = query.trim().length < SEARCH_MIN_LENGTH;

  return (
    <div className="no-print fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-label="Поиск по сайту">
      <button type="button" aria-label="Закрыть поиск" onClick={close} className="absolute inset-0 bg-ink-primary/40" />
      <div className="absolute left-1/2 top-[8vh] -translate-x-1/2 w-[min(640px,calc(100vw-24px))] rounded-2xl bg-surface shadow-card-hover overflow-hidden">
        <div className="flex items-center gap-3 px-4 h-14 border-b border-line-hairline">
          <Icon name="search" className="w-5 h-5 text-ink-muted flex-none" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Клиент, телефон, № заявки, сорт…"
            className="flex-1 min-w-0 h-full bg-transparent outline-none text-base sm:text-[15px]"
            aria-label="Что ищем"
            autoComplete="off"
          />
          {busy && <span className="text-xs text-ink-muted">ищу…</span>}
          <kbd className="hidden sm:inline-block text-[11px] text-ink-muted border border-line-hairline rounded px-1.5 py-0.5">Esc</kbd>
        </div>
        <div className="max-h-[60vh] overflow-y-auto p-2">
          {error && <div className="px-3 py-3 text-sm text-status-critical">{error}</div>}
          {!error && short && (
            <div className="px-3 py-4 text-sm text-ink-secondary">
              Введите хотя бы две буквы или четыре цифры телефона. Ищется везде сразу: клиенты, заявки, лиды.
            </div>
          )}
          {!error && !short && !busy && hits.length === 0 && (
            <div className="px-3 py-4 text-sm text-ink-secondary">Ничего не нашлось по «{query.trim()}».</div>
          )}
          {hits.map((h, i) => {
            const k = KIND[h.kind];
            return (
              <button
                key={h.href}
                type="button"
                onMouseEnter={() => setCursor(i)}
                onClick={() => go(h)}
                className={clsx(
                  "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-colors",
                  i === cursor ? "bg-surface-plane" : "hover:bg-surface-plane"
                )}
              >
                <span className={clsx("w-9 h-9 rounded-full grid place-items-center flex-none", k.cls)}>
                  <Icon name={k.icon} className="w-4 h-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold truncate">{h.title}</span>
                  <span className="block text-xs text-ink-secondary truncate">
                    {k.label}
                    {h.subtitle ? ` · ${h.subtitle}` : ""}
                  </span>
                </span>
                {h.pill && (
                  <Pill tone={h.tone ?? "muted"} dot={false}>
                    {h.pill}
                  </Pill>
                )}
              </button>
            );
          })}
        </div>
        {hits.length > 0 && (
          <div className="px-4 py-2 border-t border-line-hairline text-[11.5px] text-ink-muted hidden sm:block">
            ↑↓ — выбрать · Enter — открыть · Esc — закрыть
          </div>
        )}
      </div>
    </div>
  );
}
