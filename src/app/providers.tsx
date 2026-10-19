"use client";

import { SessionProvider } from "next-auth/react";
import type { ReactNode } from "react";
import { ShellTabsProvider } from "@/components/ShellTabs";

export default function Providers({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      {/* Вкладки раздела для бокового меню (ShellTabs). */}
      <ShellTabsProvider>{children}</ShellTabsProvider>
    </SessionProvider>
  );
}
