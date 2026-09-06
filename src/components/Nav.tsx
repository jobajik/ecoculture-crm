"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import clsx from "clsx";
import { farmLabel } from "@/lib/constants";

const LINKS: { href: string; label: string; roles?: string[] }[] = [
  { href: "/", label: "Главная" },
  { href: "/orders", label: "Заявки" },
  { href: "/sales/day", label: "День", roles: ["manager", "admin"] },
  { href: "/sales", label: "Продажи", roles: ["manager", "admin"] },
  { href: "/warehouse", label: "Склад" },
  { href: "/analytics", label: "Аналитика" },
  { href: "/admin", label: "Настройки", roles: ["admin"] },
];

const ROLE_LABELS: Record<string, string> = {
  admin: "Администратор",
  warehouse: "Зав. склад",
  manager: "Менеджер",
};

export default function Nav() {
  const { data: session } = useSession();
  const pathname = usePathname();
  const role = session?.user?.role ?? "manager";

  if (!session) return null;

  const links = LINKS.filter((l) => !l.roles || l.roles.includes(role)).filter(
    (l) => l.href !== "/warehouse" || role === "warehouse" || role === "admin"
  );

  const initials = (session.user?.name ?? "?")
    .split(" ")
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  return (
    <header className="sticky top-0 z-30 border-b border-line-hairline bg-surface/85 backdrop-blur">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center gap-4">
        <Link href="/" className="flex items-center gap-2 shrink-0">
          <span className="grid place-content-center w-7 h-7 rounded-lg bg-accent text-white text-sm font-bold">
            E
          </span>
          <span className="font-semibold tracking-tight hidden sm:inline">Ecoculture-CRM</span>
        </Link>

        <nav className="flex items-center gap-0.5 flex-1 overflow-x-auto">
          {links.map((l) => {
            const active =
              l.href === "/"
                ? pathname === "/"
                : l.href === "/sales"
                ? pathname === "/sales"
                : pathname.startsWith(l.href);
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
              {session.user?.farm && ` · ${farmLabel(session.user.farm)}`}
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
