"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import clsx from "clsx";
import { ROLE_LABELS, farmLabel } from "@/lib/constants";

// В шапке — только разделы, по одному пункту на область работы. Всё, что внутри
// раздела, живёт во вкладках на самой странице (SectionTabs). Иначе у админа
// набегало десять пунктов и меню переставало читаться.
const LINKS: { href: string; label: string; roles?: string[] }[] = [
  { href: "/", label: "Главная" },
  { href: "/orders", label: "Заявки" },
  { href: "/sales", label: "Продажи", roles: ["manager", "admin"] },
  { href: "/finance", label: "Оплаты", roles: ["accountant", "admin"] },
  { href: "/warehouse", label: "Склад", roles: ["warehouse", "admin"] },
  { href: "/analytics", label: "Аналитика" },
  { href: "/admin", label: "Настройки", roles: ["admin"] },
];

export default function Nav() {
  const { data: session } = useSession();
  const pathname = usePathname();
  const role = session?.user?.role ?? "manager";

  if (!session) return null;

  const links = LINKS.filter((l) => !l.roles || l.roles.includes(role));

  const initials = (session.user?.name ?? "?")
    .split(" ")
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  return (
    <header className="sticky top-0 z-30 border-b border-line-hairline bg-surface/85 backdrop-blur">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center gap-4">
        {/* Фирменный знак вместо буквы «E»: логотип лежит в public/logo-mark.png
            (соцветие без надписи — в шапке надпись дублировала бы название). */}
        <Link href="/" className="flex items-center gap-2 shrink-0">
          <Image
            src="/logo-mark.png"
            alt="Eco Culture"
            width={28}
            height={28}
            priority
            className="w-7 h-7 object-contain"
          />
          <span className="font-semibold tracking-tight hidden sm:inline">Ecoculture-CRM</span>
        </Link>

        <nav className="flex items-center gap-0.5 flex-1 overflow-x-auto">
          {links.map((l) => {
            // Раздел подсвечен, пока мы внутри него — включая вкладки.
            const active = l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                className={clsx(
                  "px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors",
                  active
                    ? "bg-accent-soft text-accent"
                    : "text-ink-secondary hover:text-ink-primary hover:bg-surface-plane"
                )}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-2.5 shrink-0">
          <div className="hidden md:block text-right leading-tight">
            <div className="text-sm font-medium">{session.user?.name}</div>
            <div className="text-xs text-ink-muted">
              {ROLE_LABELS[role] ?? role}
              {/* Производство показываем только зав. складом: у остальных ролей
                  колонка Farm не влияет ни на что, и подпись только путала бы. */}
              {role === "warehouse" && session.user?.farm && ` · ${farmLabel(session.user.farm)}`}
            </div>
          </div>
          <span
            className="grid place-content-center w-8 h-8 rounded-full bg-surface-sunk text-xs font-semibold text-ink-secondary"
            title={session.user?.email ?? ""}
          >
            {initials}
          </span>
          <button
            onClick={() => signOut()}
            className="text-sm text-ink-muted hover:text-ink-primary transition-colors"
            title="Выйти"
          >
            Выйти
          </button>
        </div>
      </div>
    </header>
  );
}
