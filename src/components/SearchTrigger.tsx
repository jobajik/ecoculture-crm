"use client";

import clsx from "clsx";
import Icon from "./Icon";
import { openSearch } from "./CommandPalette";

/**
 * Кнопка «поиск» в шапке страницы — выглядит как поле, открывает общее окно поиска (`CommandPalette`).
 * `compact` — круглая кнопка со значком для телефона.
 */
export default function SearchTrigger({ compact = false, className }: { compact?: boolean; className?: string }) {
  if (compact) {
    return (
      <button
        type="button"
        onClick={openSearch}
        aria-label="Поиск по сайту"
        className={clsx("w-10 h-10 rounded-xl border border-line-hairline grid place-items-center text-ink-primary active:bg-surface-plane", className)}
      >
        <Icon name="search" className="w-[18px] h-[18px]" />
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={openSearch}
      className={clsx(
        "h-10 w-full max-w-[460px] rounded-xl border border-line-hairline bg-surface-plane hover:bg-surface-sunk/70 text-left flex items-center gap-2.5 px-3 text-sm text-ink-muted transition-colors",
        className
      )}
    >
      <Icon name="search" className="w-[18px] h-[18px] flex-none" />
      <span className="flex-1 truncate">Клиент, телефон, № заявки, сорт…</span>
      <kbd className="text-[11px] border border-line-hairline rounded px-1.5 py-0.5 bg-surface">Ctrl K</kbd>
    </button>
  );
}
