"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { switchItemsFarmAction } from "@/app/orders/actions";
import { unwrapValue } from "@/lib/actionResult";

export interface FarmSwitchGroup {
  /** Куда переводим: «Rose Farm» или «Есентай Агро Хим». */
  toLabel: string;
  fromLabel: string;
  items: {
    itemId: string;
    /** «Altaj · Вторая». */
    title: string;
    quantity: number;
    /** Хватает ли этой позиции на складе, куда переводим (числа соседнего склада не показываем). */
    enough: boolean;
  }[];
}

/**
 * Склад отгрузки хризантемы на заявке: Есентай ⇄ Rose Farm (17.11.2026, правила — `farmSwitch.ts`). Зав. складом
 * отмечает позиции, которых у неё нет, и переводит их соседнему складу; администратор — в обе стороны. Что можно
 * перевести, решает сервер и присылает группами; он же проверяет нажатие.
 */
export default function FarmSwitch({ orderId, groups }: { orderId: string; groups: FarmSwitchGroup[] }) {
  const router = useRouter();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  function toggle(itemId: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  }

  async function move(group: FarmSwitchGroup) {
    const ids = group.items.filter((i) => picked.has(i.itemId)).map((i) => i.itemId);
    setError("");
    setDone("");
    if (ids.length === 0) return setError("Отметьте позиции, которые нужно перевести");
    setBusy(group.toLabel);
    try {
      const res = unwrapValue(await switchItemsFarmAction(orderId, ids));
      setPicked(new Set());
      if (!res.stillMine) {
        // Своего цветка в заявке не осталось — зав. складом она больше не открывается. Уходим обычным переходом:
        // страница под нами в эту секунду уже перерисована как «не найдено», и мягкий переход из неё не срабатывал.
        window.location.assign("/warehouse");
        return;
      }
      setDone(`Переведено на ${group.toLabel}: ${res.moved} поз.`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось поменять склад");
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="space-y-4">
      {groups.map((group) => {
        const chosen = group.items.filter((i) => picked.has(i.itemId));
        return (
          <div key={group.toLabel}>
            <p className="text-sm text-ink-secondary">
              Сейчас отгружает {group.fromLabel}. Отметьте позиции, которые отгрузит {group.toLabel}: сорт, категория, количество и цена
              останутся прежними, счёт по этим позициям перейдёт на {group.toLabel}.
            </p>
            <ul className="mt-2 divide-y divide-line-hairline">
              {group.items.map((i) => (
                <li key={i.itemId}>
                  <label className="flex items-center gap-3 py-2 cursor-pointer">
                    <input type="checkbox" className="h-4 w-4 flex-none" checked={picked.has(i.itemId)} onChange={() => toggle(i.itemId)} />
                    <span className="min-w-0 flex-1 text-sm font-medium truncate" title={i.title}>
                      {i.title}
                    </span>
                    <span className="text-sm tabular-nums whitespace-nowrap">{i.quantity.toLocaleString("ru-RU")} шт.</span>
                    <span className={`text-xs whitespace-nowrap ${i.enough ? "text-ink-muted" : "text-status-critical"}`}>
                      {i.enough ? `на ${group.toLabel} есть` : `на ${group.toLabel} не хватает`}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            <button type="button" className="btn-secondary mt-2" disabled={busy !== "" || chosen.length === 0} onClick={() => move(group)}>
              {busy === group.toLabel ? "Перевожу…" : `Отгрузить с ${group.toLabel}${chosen.length ? ` · ${chosen.length} поз.` : ""}`}
            </button>
          </div>
        );
      })}
      {error && <div className="text-sm text-status-critical bg-status-critical/10 rounded-lg px-3 py-2">{error}</div>}
      {done && <div className="text-sm text-status-good">{done}</div>}
    </div>
  );
}
