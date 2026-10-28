"use client";

import { useEffect } from "react";
import { PAYROLL_FARM_COOKIE } from "@/lib/payroll/farmScope";

/** Запоминает выбранную компанию раздела «Зарплата» в браузере: пункт меню без `?farm=` откроет её же. */
export default function RememberFarm({ farm }: { farm: string }) {
  useEffect(() => {
    try {
      document.cookie = `${PAYROLL_FARM_COOKIE}=${encodeURIComponent(farm)}; path=/; max-age=31536000; samesite=lax`;
    } catch {
      /* без cookie — просто не запомним */
    }
  }, [farm]);
  return null;
}
