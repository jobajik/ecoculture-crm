"use client";

import { useState, type ReactNode } from "react";

/**
 * Пояснение по нажатию — маленький «?» вместо абзаца текста.
 *
 * Владелец: «сайт перегружен надписями и подсказками». Замер на копии показал,
 * что на главной у зав. складом больше половины слов — объяснения «почему
 * так». Нужны они изредка, а мешают каждый день. Поэтому объяснение, без
 * которого можно работать, прячется сюда: кто хочет понять — нажмёт, остальные
 * видят только дело.
 *
 * Не для предупреждений и ошибок: то, что человек обязан увидеть до действия,
 * пишется открыто.
 */
export default function Hint({ children, label = "Пояснение" }: { children: ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="inline">
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center justify-center w-5 h-5 ml-1 align-middle rounded-full border border-line-hairline text-[11px] font-medium text-ink-muted hover:text-ink-primary hover:border-ink-muted"
      >
        ?
      </button>
      {open && (
        <span className="block mt-1.5 text-xs font-normal text-ink-secondary bg-surface-plane rounded-lg px-3 py-2 max-w-prose">
          {children}
        </span>
      )}
    </span>
  );
}
