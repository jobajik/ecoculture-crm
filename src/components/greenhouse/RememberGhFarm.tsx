"use client";

import { useEffect } from "react";
import { GREENHOUSE_FARM_COOKIE } from "@/lib/greenhouse/farm";

/** Запоминает компанию «Теплицы» в браузере: пункт меню без `?farm=` откроет её же. */
export default function RememberGhFarm({ farm }: { farm: string }) {
  useEffect(() => {
    try {
      document.cookie = `${GREENHOUSE_FARM_COOKIE}=${encodeURIComponent(farm)}; path=/; max-age=31536000; samesite=lax`;
    } catch {
      /* без cookie — просто не запомним */
    }
  }, [farm]);
  return null;
}
