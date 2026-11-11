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
        className={clsx("w-10 h-10 rounded-lg grid place-items-center text-ink-secondary hover:bg-surface-plane active:bg-surface-sunk", className)}
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
        "h-9 w-full rounded-lg border border-line-hairline bg-surface-plane hover:border-line-strong text-left flex items-center gap-2 px-2.5 text-[13px] text-ink-muted transition-colors",
        className
      )}
    >
      <Icon name="search" className="w-4 h-4 flex-none" />
      <span className="flex-1 truncate">Поиск</span>
      <kbd className="text-[10.5px] font-sans border border-line-hairline rounded px-1 py-px bg-surface text-ink-muted">Ctrl K</kbd>
    </button>
  );
}
