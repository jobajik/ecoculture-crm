"use client";

import { useSession } from "next-auth/react";
import SidebarMenu from "./SidebarMenu";

/**
 * Меню на компьютере — колонка слева во всю высоту окна (19.10.2026, новый вид сайта по образцу владельца).
 * Раньше это была шапка с разделами в одну строку, которая не помещалась у администратора и пряталась под «Ещё».
 * Теперь разделы стоят столбиком, у активного — вкладки подпунктами. На телефоне и планшете то же меню выезжает
 * слева по кнопке ☰ (`MobileNav`).
 */
export default function Nav() {
  const { data: session } = useSession();
  if (!session) return null;
  return (
    <aside className="no-print hidden lg:block w-[248px] flex-none">
      <div className="sticky top-0 h-screen overflow-hidden border-r border-line-hairline bg-surface px-3.5 py-4">
        <SidebarMenu />
      </div>
    </aside>
  );
}
