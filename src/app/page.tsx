import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { authOptions } from "@/lib/auth";
import { getStockSnapshot } from "@/lib/stock";
import { farmLabel, flowerTypesForFarm } from "@/lib/constants";
import StockBoard from "@/components/StockBoard";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function HomePage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");

  const role = session.user?.role ?? "manager";
  const farm = role === "warehouse" ? session.user?.farm ?? null : null;
  const snapshot = await getStockSnapshot(new Date(), undefined, farm);

  // На главной — только разделы, по одному на область работы. Подстраницы
  // открываются вкладками внутри раздела, чтобы не заваливать человека выбором.
  const cards = [
    {
      href: "/orders/new",
      title: "Принять заявку",
      desc: "Оформить заявку клиента: сорт, длина, количество, цена, дата доставки",
      show: role === "manager" || role === "admin",
      emoji: "📝",
    },
    {
      href: "/orders",
      title: "Заявки",
      desc: "Все заявки со статусами и отметками готовности",
      show: true,
      emoji: "📋",
    },
    {
      href: "/warehouse",
      title: "Склад",
      desc: "Отгрузка, заявка на день для сборки, приёмка с производства, партии",
      show: role === "warehouse" || role === "admin",
      emoji: "📦",
    },
    {
      href: "/finance",
      title: "Оплаты",
      desc: "Отметка оплат, долги клиентов и отчёт с выгрузкой в Excel",
      show: role === "accountant" || role === "admin",
      emoji: "💳",
    },
    {
      href: "/sales",
      title: "Продажи",
      desc: "Рейтинг менеджеров и бонусы, план и факт, продажи за день",
      show: role === "manager" || role === "admin",
      emoji: "🏆",
    },
    {
      href: "/analytics",
      title: "Аналитика",
      desc: "Динамика продаж и цен, сроки хранения, списания",
      show: true,
      emoji: "📊",
    },
    {
      href: "/admin",
      title: "Настройки",
      desc: "Сотрудники, роли, производства, сроки хранения",
      show: role === "admin",
      emoji: "⚙️",
    },
  ].filter((c) => c.show);

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">
            Добро пожаловать, {session.user?.name?.split(" ")[0]}
          </h1>
          <p className="text-ink-secondary">
            Что сейчас лежит на складе и сколько дней с момента срезки
            {farm && <> — производство {farmLabel(farm)}</>}.
          </p>
        </div>
        {/* Логотип компании — только на широком экране, чтобы не съедать место на телефоне. */}
        <Image
          src="/logo.png"
          alt="Eco Culture"
          width={1020}
          height={593}
          priority
          className="hidden sm:block w-32 h-auto shrink-0"
        />
      </div>

      <StockBoard initial={snapshot} allowedTypes={flowerTypesForFarm(farm)} />

      <div>
        <h2 className="text-lg font-semibold mb-3">Разделы</h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {cards.map((c) => (
            <Link key={c.href} href={c.href} className="card hover:shadow-md transition-shadow">
              <div className="text-2xl mb-2">{c.emoji}</div>
              <div className="font-medium mb-1">{c.title}</div>
              <div className="text-sm text-ink-secondary">{c.desc}</div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
