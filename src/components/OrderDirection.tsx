"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { SHIPMENT_DIRECTIONS } from "@/lib/constants";
import { setOrderDirectionAction } from "@/app/orders/actions";
import { unwrap } from "@/lib/actionResult";

/**
 * Направление отгрузки на странице заявки — с возможностью поменять.
 *
 * Раньше здесь стояла надпись без кнопки: направление ставил только РОП, и
 * только из своего раздела. Владелец решил иначе — «пусть менеджер сам заявку
 * по Киргизии делает, без РОПа», — и тогда исправлять его тоже должен менеджер:
 * выбрал в форме не тот город, и без этой кнопки ему снова пришлось бы идти к
 * РОПу, то есть ради чего всё и менялось.
 *
 * Открывается надписью, а не выпадающим списком наготове: направление правят
 * редко, а список из десяти городов рядом с датой доставки читался бы как
 * «выбери что-нибудь».
 *
 * Пустое направление показано словами «Алматы и округа», а не прочерком. Пусто
 * здесь — это не «не заполнили», а осмысленный ответ: в плане по регионам
 * Алматы нет, и заявка по городу туда попадать не должна. Прочерк заставлял бы
 * каждый раз вспоминать, что он означает.
 */
export default function OrderDirection({
  orderId,
  direction,
  editable,
  suggested = "",
  hint,
}: {
  orderId: string;
  direction: string;
  /** Может ли этот человек поменять направление ИМЕННО в этой заявке. */
  editable: boolean;
  /**
   * Что подставить, когда направления ещё нет, — по городу клиента. Тот же
   * приём, что в списке РОПа: предложенное уже выбрано, и нажатие ровно одно.
   * Само по себе оно ничего не записывает — человек видит его до сохранения.
   */
  suggested?: string;
  /** Подсказка по городу клиента — почему предлагается именно это. */
  hint?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(direction || suggested);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const label = direction || "Алматы и округа";

  async function save() {
    setError(null);
    setSaving(true);
    try {
      unwrap(await setOrderDirectionAction(orderId, value));
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось поменять направление");
    } finally {
      setSaving(false);
    }
  }

  if (!editable) {
    return (
      <div>
        <div className="label">Направление отгрузки</div>
        <div>{label}</div>
      </div>
    );
  }

  return (
    <div>
      <div className="label">Направление отгрузки</div>
      {open ? (
        <div className="space-y-2">
          <select className="input" value={value} onChange={(e) => setValue(e.target.value)}>
            <option value="">Алматы и округа</option>
            {SHIPMENT_DIRECTIONS.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
          {hint && <span className="block text-xs text-ink-muted">{hint}</span>}
          {error && <div className="text-sm text-status-critical">{error}</div>}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="btn-secondary !py-1.5 text-sm disabled:opacity-50"
            >
              {saving ? "Сохраняю…" : "Сохранить"}
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setValue(direction || suggested);
                setError(null);
              }}
              disabled={saving}
              className="text-sm text-ink-muted hover:text-ink-primary"
            >
              Отмена
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-baseline gap-2">
          <span>{label}</span>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="text-xs text-ink-muted hover:text-ink-primary underline"
          >
            поменять
          </button>
        </div>
      )}
    </div>
  );
}
