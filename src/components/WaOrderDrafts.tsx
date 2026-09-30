"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { dismissWaDraftAction } from "@/app/orders/wa-actions";
import { unwrap } from "@/lib/actionResult";
import Section from "./Section";
import Hint from "./Hint";

export interface WaDraftRow {
  draftId: string;
  at: string;
  who: string;
  /** Клиента с этим номером нет в базе — его заведут при оформлении. */
  unknown: boolean;
  managerName: string;
  text: string;
  summary: string;
  delivery: string;
}

/** «Заказы из WhatsApp» над списком заявок: ИИ разобрал, менеджер оформляет. */
export default function WaOrderDrafts({ rows }: { rows: WaDraftRow[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [hidden, setHidden] = useState<string[]>([]);
  const visible = rows.filter((r) => !hidden.includes(r.draftId));
  if (visible.length === 0) return null;

  function dismiss(id: string) {
    setError(null);
    start(async () => {
      try {
        unwrap(await dismissWaDraftAction(id));
        setHidden((h) => [...h, id]);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Не удалось скрыть");
      }
    });
  }

  return (
    <Section
      tone="order"
      icon="message"
      title={
        <>
          Заказы из WhatsApp: {visible.length}{" "}
          <Hint>
            Клиент написал на рабочий номер, ИИ разобрал сообщение. «Оформить» открывает обычную форму заявки уже
            заполненной — проверьте сорт, длину и цену и сохраните. Пока не сохранили, это не заявка.
          </Hint>
        </>
      }
      flush
    >
      <ul className="divide-y divide-line-hairline">
        {visible.map((r) => (
          <li key={r.draftId} className="px-4 py-3 flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-sm">
                <span className="font-medium">{r.who}</span>
                {r.unknown ? (
                  <span className="ml-2 text-xs text-[#8a5a00]">нет в базе</span>
                ) : (
                  r.managerName && <span className="ml-2 text-xs text-ink-muted">{r.managerName}</span>
                )}
                <span className="ml-2 text-xs text-ink-muted">{r.at}</span>
              </div>
              <div className="text-sm mt-0.5">
                {r.summary}
                {r.delivery && <span className="text-ink-secondary"> · на {r.delivery}</span>}
              </div>
              <div className="text-xs text-ink-muted mt-0.5 line-clamp-2">«{r.text}»</div>
            </div>
            <div className="flex gap-2 shrink-0">
              <Link href={`/orders/new?draft=${encodeURIComponent(r.draftId)}`} className="btn-primary !py-1.5 text-sm">
                Оформить
              </Link>
              <button type="button" className="btn-secondary !py-1.5 text-sm" disabled={pending} onClick={() => dismiss(r.draftId)}>
                Скрыть
              </button>
            </div>
          </li>
        ))}
      </ul>
      {error && <p className="px-4 pb-3 text-sm text-status-critical">{error}</p>}
    </Section>
  );
}
