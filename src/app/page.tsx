import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { authOptions } from "@/lib/auth";
import { getStockSnapshot } from "@/lib/stock";
import { farmLabel, flowerTypesForFarm, isFarmBoundRole } from "@/lib/constants";
import StockBoard from "@/components/StockBoard";
import HomeFocusBoard from "@/components/HomeFocus";
import { homeFocus } from "@/lib/homeFocus";
import { listOrdersWithItems } from "@/lib/repo/orders";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function HomePage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");

  const role = session.user?.role ?? "manager";
  // Зав. складом и агроном привязаны к производству — им и остатки показываем
  // только по своему цветку. Остальные роли видят всё.
  const farm = isFarmBoundRole(role) ? session.user?.farm ?? null : null;
  const snapshot = await getStockSnapshot(new Date(), undefined, farm);

  // «Что у вас сегодня» — короткий блок про СВОЮ работу. До него главная у всех
  // была одной и той же сводкой по складу: зав. складом это ровно её дело, а
  // менеджеру — три экрана чужих цифр, под которыми лежит кнопка «Принять
  // заявку» (на телефоне девять экранов прокрутки). Считается чистой функцией
  // из уже прочитанных заявок — `scripts/check-home-focus.ts`.
  const now = new Date();
  const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate()
  ).padStart(2, "0")}`;
  const focus = homeFocus({
    role,
    email: session.user?.email ?? "",
    orders: await listOrdersWithItems(),
    todayKey,
  });

  // На главной — только разделы, по одному на область работы. Подстраницы
  // открываются вкладками внутри раздела, чтобы не заваливать человека выбором.
  const cards = [
    {
      href: "/orders/new",
      title: "Принять заявку",
      desc: "Новая заявка клиента",
      show: role === "manager" || role === "admin",
      emoji: "📝",
    },
    {
      href: "/orders",
      title: "Заявки",
      desc: "Все заявки и их статусы",
      show: true,
      emoji: "📋",
    },
    {
      href: "/warehouse",
      title: "Склад",
      desc: "Отгрузка, сборка, приёмка",
      show: role === "warehouse" || role === "admin",
      emoji: "📦",
    },
    {
      href: "/finance",
      title: "Оплаты",
      desc: "Оплаты, долги, отчёт",
      show: role === "accountant" || role === "admin",
      emoji: "💳",
    },
    {
      href: "/sales",
      title: "Продажи",
      desc: "Рейтинг, бонусы, план-факт",
      show: role === "manager" || role === "sales_head" || role === "admin",
      emoji: "🏆",
    },
    {
      href: "/plans",
      title: "Планы",
      desc:
        role === "admin"
          ? "Продажи, отгрузки, срезка"
          : "Продажи и отгрузки",
      show: role === "sales_head" || role === "admin",
      emoji: "🎯",
    },
    {
      href: "/forecast",
      title: "Прогноз срезки",
      desc: "Ростовка на месяц",
      show: role === "agronomist",
      emoji: "🌱",
    },
    {
      href: "/analytics",
      title: "Аналитика",
      desc: "Продажи, цены, списания",
      show: true,
      emoji: "📊",
    },
    {
      href: "/admin",
      title: "Настройки",
      desc: "Сотрудники и сроки хранения",
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
          {/* Подпись описывает страницу целиком, а не один блок на ней: с
              появлением «что у вас сегодня» обещание «здесь про склад» стало
              наполовину неверным. */}
          {farm && <p className="text-ink-secondary">Производство {farmLabel(farm)}</p>}
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

      {focus?.aboveStock && <HomeFocusBoard focus={focus} />}

      <StockBoard initial={snapshot} allowedTypes={flowerTypesForFarm(farm)} />

      {focus && !focus.aboveStock && <HomeFocusBoard focus={focus} />}

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
