"use client";

import { useRouter } from "next/navigation";
import clsx from "clsx";
import type { CycleOption } from "@/lib/greenhouse/views";

/**
 * Выбор цикла списком (29.10.2026, владелец: «сделай как выбирающей опцией, чтобы было понятно, какой цикл текущий»).
 * Рядом — метка «текущий» или ссылка «к текущему». Переход — сменой адреса (`hrefFor`).
 */
export default function CycleSelect({ options, value, hrefs, className }: { options: CycleOption[]; value: number; hrefs: Record<number, string>; className?: string }) {
  const router = useRouter();
  const current = options.find((o) => o.current);
  const selected = options.find((o) => o.cycle === value);
  return (
    <div className={clsx("flex items-center gap-2", className)}>
      <label className="relative">
        <span className="sr-only">Цикл</span>
        <select
          className="input !h-10 !py-1.5 pr-8 font-medium min-w-[15rem]"
          value={value}
          onChange={(e) => {
            const href = hrefs[Number(e.target.value)];
            if (href) router.push(href);
          }}
        >
          {options.map((o) => (
            <option key={o.cycle} value={o.cycle}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      {selected?.current ? null : current ? (
        <button type="button" className="text-xs underline whitespace-nowrap text-ink-secondary" onClick={() => router.push(hrefs[current.cycle])}>
          к текущему ({current.cycle})
        </button>
      ) : null}
    </div>
  );
}
