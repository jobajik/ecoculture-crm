"use client";

import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

/**
 * Тонкая полоска вверху экрана, пока открывается другая страница.
 *
 * Данные идут из Google-таблицы, и на телефоне страница открывается секунду-
 * две. Без знака «уже открываю» люди жали ещё раз, а повторное нажатие на
 * кнопку действия — это тот самый двойной платёж или двойная отгрузка.
 *
 * Раньше это делал `app/loading.tsx` (серый скелет страницы), и его пришлось
 * убрать: с ним `router.refresh()` после КАЖДОГО сохранения пересоздавал всю
 * страницу, и сообщения «Сохранено», открытые формы и введённое пропадали
 * сразу после нажатия. Проверено на боевой сборке: без него страница при
 * обновлении данных остаётся той же. Полоска живёт в шапке и страницу не трогает.
 */
export default function NavProgress() {
  const pathname = usePathname();
  const search = useSearchParams();
  const [active, setActive] = useState(false);

  // Пришли на новую страницу (или сменились фильтры в адресе) — полоска гаснет.
  useEffect(() => {
    setActive(false);
  }, [pathname, search]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const link = (e.target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!link || link.target === "_blank" || link.hasAttribute("download")) return;
      const url = new URL(link.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      // Файл (шаблон Excel) и ссылка на место на той же странице — не переход.
      if (url.pathname.startsWith("/api/")) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      setActive(true);
    }
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  // Страховка: если переход не случился (сеть, отказ), полоска не должна висеть вечно.
  useEffect(() => {
    if (!active) return;
    const t = setTimeout(() => setActive(false), 15000);
    return () => clearTimeout(t);
  }, [active]);

  if (!active) return null;
  return (
    <div
      role="progressbar"
      aria-label="Открываю страницу"
      className="fixed inset-x-0 top-0 z-[60] h-0.5 overflow-hidden bg-accent/20"
    >
      <div className="h-full w-1/3 bg-accent animate-[navprogress_1.1s_ease-in-out_infinite] motion-reduce:animate-none motion-reduce:w-full" />
    </div>
  );
}
