"use client";

import { useEffect } from "react";
import { GREENHOUSE_FARM_COOKIE, GREENHOUSE_FARM_EVENT } from "@/lib/greenhouse/farm";

/** Запоминает компанию «Теплицы» в браузере (адреса без `?farm=` откроют её же) и сообщает её меню. */
export default function RememberGhFarm({ farm }: { farm: string }) {
  useEffect(() => {
    try {
      document.cookie = `${GREENHOUSE_FARM_COOKIE}=${encodeURIComponent(farm)}; path=/; max-age=31536000; samesite=lax`;
    } catch {
      /* без cookie — просто не запомним */
    }
    // Меню (два раздела теплиц) подсвечивает раздел этой компании.
    window.dispatchEvent(new CustomEvent(GREENHOUSE_FARM_EVENT, { detail: farm }));
  }, [farm]);
  return null;
}
