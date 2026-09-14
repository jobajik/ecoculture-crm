"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { setInvoiceNoteAction, setInvoiceSentAction } from "@/app/finance/actions";
import { PAYMENT_STAGES, type PaymentStage } from "@/lib/paymentStage";
import StageBadge from "./StageBadge";
import { formatDay } from "@/lib/formatDate";
import { unwrap } from "@/lib/actionResult";

/**
 * Стадия оплаты в строке — и работа с ней там же.
 *
 * Отметка об отправке счёта уже была, но ставилась только внутри панели оплаты:
 * бухгалтеру приходилось раскрыть строку, найти нужную надпись и нажать. Два
 * действия и чужой экран ради одного слова. Владелец споткнулся на этом так:
 * «сейчас со списка не отправлены два счёта, т. к. номера тел неверные, теперь
 * надо искать который из них не отправлен».
 *
 * Отсюда две вещи в этой клетке:
 *
 * - **«счёт отправлен» — одно нажатие прямо в строке.** Обратное снятие
 *   спрятано под саму надпись: ошибиться можно, но случайно — вряд ли;
 * - **заметка, ПОЧЕМУ счёт ещё не ушёл** («неверный телефон», «ждём
 *   реквизиты»). Она отвечает на вопрос, на который отметка ответить не может,
 *   и держать его в голове до завтра бухгалтер больше не обязана. Заметка
 *   живёт только до отправки: отметил счёт — она стирается сама, иначе через
 *   месяц рядом с отправленным счётом висело бы «ждём реквизиты».
 *
 * Пустая отметка называется «отметки нет», а не «счёт не отправлен». Колонка
 * появилась в сентябре, и у прежних заявок она пуста — назвать их
 * неотправленными значило бы соврать про счета, отправленные руками (грабли
 * 1.10: пустая ячейка ничего не утверждает).
 */
export default function InvoiceCell({
  orderId,
  stage,
  invoiceSentAt,
  invoiceNote,
  canEdit,
}: {
  orderId: string;
  stage: PaymentStage;
  invoiceSentAt: string;
  invoiceNote: string;
  /** Отмечать может только бухгалтер и админ; остальным — только смотреть. */
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editingNote, setEditingNote] = useState(false);
  const [draft, setDraft] = useState(invoiceNote);

  const sent = Boolean((invoiceSentAt || "").trim());
  // Деньги перебивают отметку: по оплаченной заявке вопрос «отправляли ли счёт»
  // уже не стоит, и кнопка там была бы лишним способом ошибиться.
  const money = stage === PAYMENT_STAGES.PARTIAL || stage === PAYMENT_STAGES.PAID;

  function run(work: () => Promise<unknown>, fallback: string) {
    setError(null);
    startTransition(async () => {
      try {
        await work();
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : fallback);
      }
    });
  }

  function toggleSent() {
    run(async () => {
      unwrap(await setInvoiceSentAction(orderId, !sent));
      if (!sent) setDraft("");
    }, "Не удалось поставить отметку");
  }

  function saveNote() {
    run(async () => {
      unwrap(await setInvoiceNoteAction(orderId, draft));
      setEditingNote(false);
    }, "Не удалось сохранить заметку");
  }

  return (
    <div className="space-y-1">
      {/* На каждое направление ровно один способ нажать: поставить отметку —
          ссылкой «отметить», снять — нажатием на саму надпись. Две кнопки,
          делающие одно и то же, в узкой строке читаются как разные действия. */}
      <div className="flex flex-wrap items-center gap-1.5">
        {canEdit && sent && !money ? (
          <button
            type="button"
            onClick={toggleSent}
            disabled={pending}
            title="Снять отметку об отправке счёта"
            className="disabled:opacity-50"
          >
            <StageBadge stage={stage} />
          </button>
        ) : (
          <StageBadge stage={stage} />
        )}
        {sent && (
          <span className="text-xs text-ink-muted whitespace-nowrap">
            {formatDay(invoiceSentAt)}
          </span>
        )}
        {canEdit && !sent && !money && (
          <button
            type="button"
            onClick={toggleSent}
            disabled={pending}
            title="Отметить, что счёт отправлен клиенту"
            className="text-xs text-accent hover:underline disabled:opacity-50 whitespace-nowrap"
          >
            {pending ? "…" : "отметить"}
          </button>
        )}
      </div>

      {/* Заметка нужна ровно там, где счёт ещё не ушёл. У отправленного и у
          оплаченного объяснять нечего. */}
      {!sent && !money && (
        <div className="text-xs">
          {editingNote ? (
            <div className="flex flex-wrap items-center gap-1">
              <input
                autoFocus
                className="input !py-1 !px-2 !text-xs !w-40"
                placeholder="почему не ушёл"
                value={draft}
                maxLength={200}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveNote();
                  if (e.key === "Escape") {
                    setDraft(invoiceNote);
                    setEditingNote(false);
                  }
                }}
              />
              <button
                type="button"
                onClick={saveNote}
                disabled={pending}
                className="text-accent hover:underline disabled:opacity-50"
              >
                ок
              </button>
            </div>
          ) : invoiceNote ? (
            <button
              type="button"
              onClick={() => canEdit && setEditingNote(true)}
              className={clsx(
                "text-left text-[#8a5a00]",
                canEdit && "hover:underline"
              )}
              title={canEdit ? "Изменить заметку" : undefined}
            >
              {invoiceNote}
            </button>
          ) : (
            canEdit && (
              <button
                type="button"
                onClick={() => setEditingNote(true)}
                className="text-ink-muted hover:text-ink-primary hover:underline"
              >
                почему?
              </button>
            )
          )}
        </div>
      )}

      {error && <div className="text-xs text-status-critical">{error}</div>}
    </div>
  );
}
