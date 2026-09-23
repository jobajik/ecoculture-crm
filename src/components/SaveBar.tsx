"use client";

/**
 * Полоска «Изменено N · Отменить · Сохранить» у нижнего края экрана.
 *
 * Появляется, только когда есть что сохранить. Раньше под длинной сеткой всегда
 * стояла серая неактивная кнопка «Сохранить» и надпись «Изменений нет» — лишний
 * шум, когда ничего не менялось, и кнопка за два экрана от поля, когда менялось.
 * На телефоне полоска стоит над нижней панелью разделов, а не на ней.
 */
export default function SaveBar({
  count,
  what,
  saving,
  onSave,
  onReset,
}: {
  count: number;
  /** Родительный падеж: «ячеек», «цен». */
  what: string;
  saving: boolean;
  onSave: () => void;
  onReset?: () => void;
}) {
  if (count === 0) return null;
  return (
    <div className="no-print fixed inset-x-0 bottom-16 sm:bottom-5 z-30 flex justify-center px-4 pointer-events-none">
      <div className="pointer-events-auto flex items-center gap-3 rounded-xl border border-line-hairline bg-surface px-4 py-2.5 shadow-card-hover">
        <span className="text-sm text-ink-secondary tabular-nums">
          Изменено {what}: <b className="text-ink-primary">{count}</b>
        </span>
        {onReset && (
          <button type="button" className="btn !py-1.5 text-ink-secondary" onClick={onReset} disabled={saving}>
            Отменить
          </button>
        )}
        <button type="button" className="btn-primary !py-1.5 disabled:opacity-50" onClick={onSave} disabled={saving}>
          {saving ? "Сохраняю…" : "Сохранить"}
        </button>
      </div>
    </div>
  );
}
