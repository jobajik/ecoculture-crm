import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { authOptions } from "@/lib/auth";
import { getStockSnapshot } from "@/lib/stock";
import { farmLabel } from "@/lib/constants";
import StockBoard from "@/components/StockBoard";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function HomePage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");

  const role = session.user?.role ?? "manager";
  const farm = role === "warehouse" ? session.user?.farm ?? null : null;
  const snapshot = await getStockSnapshot(new Date(), undefined, farm);

  const cards = [
    {
      href: "/orders/new",
      title: "Принять заявку",
      desc: "Оформить заявку клиента: сорт, длина или категория, количество, цена, дата доставки",
      show: role === "manager" || role === "admin",
      emoji: "📝",
    },
    {
      href: "/orders",
      title: "Все заявки",
      desc: "Список заявок со статусами: новая, в работе, готова к отгрузке, отгружена",
      show: true,
      emoji: "📋",
    },
    {
      href: "/warehouse",
      title: "Склад: отгрузка",
      desc: "Заявки к отгрузке, приёмка партий с производства, списание",
      show: role === "warehouse" || role === "admin",
      emoji: "📦",
    },
    {
      href: "/warehouse/picklist",
      title: "Заявка на день",
      desc: "Сводный лист для сборки заказов: что набрать со склада и как разложить по клиентам",
      show: role === "warehouse" || role === "admin",
      emoji: "🖨",
    },
    {
      href: "/sales/day",
      title: "Продажи за день",
      desc: "Кто сколько продал сегодня, каких цветов, в какое время — в реальном времени",
      show: role === "manager" || role === "admin",
      emoji: "⚡",
    },
    {
      href: "/sales",
      title: "Продажи менеджеров",
      desc: "План и факт по каждому менеджеру: за день, за месяц, выполнение плана",
      show: role === "manager" || role === "admin",
      emoji: "🎯",
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
      desc: "Сотрудники, роли, сроки хранения по типам цветка",
      show: role === "admin",
      emoji: "⚙️",
    },
  ].filter((c) => c.show);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold">
          Добро пожаловать, {session.user?.name?.split(" ")[0]}
        </h1>
        <p className="text-ink-secondary">
          Что сейчас лежит на складе и сколько дней с момента срезки
          {farm && <> — производство {farmLabel(farm)}</>}.
        </p>
      </div>

      <StockBoard initial={snapshot} />

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
