"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

/**
 * Вкладки раздела для бокового меню (19.10.2026, новый вид сайта: меню слева, как на образце владельца).
 *
 * Вкладки по-прежнему задаёт СТРАНИЦА (`PageHeader tabs=…` → `SectionTabs`): у каждой роли свой набор, и считать их
 * второй раз в меню значило бы держать две копии правил. `SectionTabs` кладёт свой список сюда, а боковое меню
 * показывает его подпунктами под активным разделом. Ушла со страницы — список убирается.
 */
export interface ShellTab {
  href: string;
  label: string;
  match?: string[];
}

interface ShellTabsValue {
  tabs: ShellTab[];
  setTabs: (tabs: ShellTab[]) => void;
}

const Ctx = createContext<ShellTabsValue>({ tabs: [], setTabs: () => {} });

export function ShellTabsProvider({ children }: { children: ReactNode }) {
  const [tabs, setTabs] = useState<ShellTab[]>([]);
  const value = useMemo(() => ({ tabs, setTabs }), [tabs]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useShellTabs(): ShellTab[] {
  return useContext(Ctx).tabs;
}

/** Страница сообщает вкладки своего раздела; при уходе со страницы они убираются. */
export function useRegisterShellTabs(tabs: ShellTab[]) {
  const { setTabs } = useContext(Ctx);
  const key = JSON.stringify(tabs);
  useEffect(() => {
    setTabs(JSON.parse(key) as ShellTab[]);
    return () => setTabs([]);
  }, [key, setTabs]);
}

/** Горит ли вкладка на этом адресе — одно правило для вкладок страницы и подпунктов меню. */
export function isTabActive(tab: ShellTab, pathname: string): boolean {
  return tab.match ? tab.match.includes(pathname) : pathname === tab.href;
}
