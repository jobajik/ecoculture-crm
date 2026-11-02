"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { GREENHOUSE_FARM_COOKIE, GREENHOUSE_FARM_EVENT, pickGreenhouseFarm } from "@/lib/greenhouse/farm";

/**
 * Какая теплица открыта — для подсветки меню (два раздела «Теплица Rose Farm» / «Теплица Есентай» с одними адресами).
 * Правило то же, что у страниц (`pickGreenhouseFarm`: адрес, потом cookie). `useSearchParams` здесь нет: меню стоит в
 * каркасе, и без Suspense он ломал бы сборку статичных страниц. Смену компании без смены пути (`?farm=` у того же
 * `/greenhouse`) сообщает `RememberGhFarm` событием.
 */
export function useGhFarm(): string {
  const pathname = usePathname();
  const [farm, setFarm] = useState(() => pickGreenhouseFarm(undefined, undefined));
  useEffect(() => {
    const read = () => {
      try {
        const param = new URLSearchParams(window.location.search).get("farm") ?? undefined;
        const cookie = document.cookie
          .split("; ")
          .find((c) => c.startsWith(GREENHOUSE_FARM_COOKIE + "="))
          ?.split("=")[1];
        setFarm(pickGreenhouseFarm(param, cookie ? decodeURIComponent(cookie) : undefined));
      } catch {
        /* нет доступа к адресу или cookie — остаётся прежнее */
      }
    };
    read();
    const onFarm = (e: Event) => {
      const f = (e as CustomEvent<string>).detail;
      if (typeof f === "string" && f) setFarm(f);
    };
    window.addEventListener(GREENHOUSE_FARM_EVENT, onFarm);
    return () => window.removeEventListener(GREENHOUSE_FARM_EVENT, onFarm);
  }, [pathname]);
  return farm;
}
