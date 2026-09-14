import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";

// Кто какие разделы может открывать. "admin" по умолчанию имеет доступ всюду.
const ROLE_ACCESS: { prefix: string; roles: string[] }[] = [
  // Собственная розница. Менеджеры розницы живут в своём разделе и в заявках;
  // клиентская база, деньги, планы и склад им не нужны и закрыты.
  // Зав. складом производства сюда пускаем ради вкладки «Регионы»: пока
  // заявки по Астане, Семею и Усть-Каменогорску заводит она. Что именно ей
  // видно внутри раздела, решают вкладки (`retailTabsFor`) и сами страницы.
  {
    prefix: "/retail",
    roles: ["retail_almaty", "retail_regions", "sales_head", "admin", "warehouse"],
  },
  // РОП заводит оптовые заявки в регионы — так решил владелец. Заявки по
  // Алматы остаются у менеджеров, и это проверяется не здесь, а в самом
  // действии: у региональной заявки обязано быть направление.
  {
    prefix: "/orders/new",
    roles: ["manager", "retail_almaty", "retail_regions", "admin", "warehouse", "sales_head"],
  },
  { prefix: "/warehouse", roles: ["warehouse", "admin"] },
  // Рекламацию заводит менеджер, а решение по ней видит у бухгалтера. Раньше
  // весь /finance был закрыт от менеджера, и он не мог узнать, чем кончилась
  // его же жалоба, хотя страница /finance/claims его пускала.
  { prefix: "/finance/claims", roles: ["accountant", "manager", "sales_head", "admin"] },
  // Удержания с сотрудников и журнал действий бухгалтера — не про продажи:
  // первое кадровое, второе служебное. РОПу они не нужны, и правила стоят ВЫШЕ
  // общего «/finance», потому что совпадение ищется по первому подходящему.
  { prefix: "/finance/takeouts", roles: ["accountant", "admin"] },
  { prefix: "/finance/log", roles: ["accountant", "admin"] },
  // РОП видит оплаты, долги и отчёт — но ничего в них не меняет: право смотреть
  // и право трогать разведены (`src/lib/financeAccess.ts`). Так попросил
  // владелец: «просто чтобы видела долги и прочее».
  { prefix: "/finance", roles: ["accountant", "admin", "sales_head"] },
  // РОП по замыслу видит продажи — их же он и планирует. В списке его не было,
  // и middleware разворачивал его с собственного раздела.
  { prefix: "/sales", roles: ["manager", "sales_head", "admin", "accountant"] },
  { prefix: "/prices", roles: ["manager", "sales_head", "admin"] },
  { prefix: "/plans", roles: ["sales_head", "admin"] },
  { prefix: "/forecast", roles: ["agronomist", "admin"] },
  // Агроном отвечает за срезку, а не за деньги: заявки и аналитика хозяйства
  // ему не нужны, а видел он их целиком по обоим производствам.
  {
    prefix: "/orders",
    roles: [
      "manager",
      "warehouse",
      "accountant",
      "sales_head",
      "admin",
      "retail_almaty",
      "retail_regions",
    ],
  },
  { prefix: "/analytics", roles: ["manager", "warehouse", "accountant", "sales_head", "admin"] },
  // Карточка магазина — та же карточка клиента, и держать её вторую копию в
  // разделе розницы значило бы чинить потом обе. Список клиентов менеджеру
  // розницы всё равно не показывается: страница разворачивает его в «Розницу».
  {
    prefix: "/clients",
    roles: [
      "manager",
      "sales_head",
      "accountant",
      "admin",
      "retail_almaty",
      "retail_regions",
    ],
  },
  { prefix: "/admin", roles: ["admin"] },
];

export default withAuth(
  function middleware(req) {
    // Роли по умолчанию нет: пустая роль означает, что сотрудника нет в таблице
    // Users или он отключён, — такого не пускаем никуда, кроме входа.
    const role = (req.nextauth.token?.role as string) || "";
    if (role === "admin") return NextResponse.next();
    if (!role) {
      const url = req.nextUrl.clone();
      url.pathname = "/login";
      url.searchParams.set("error", "AccessDenied");
      return NextResponse.redirect(url);
    }

    const path = req.nextUrl.pathname;
    const rule = ROLE_ACCESS.find((r) => path.startsWith(r.prefix));
    if (rule && !rule.roles.includes(role)) {
      const url = req.nextUrl.clone();
      url.pathname = "/";
      url.searchParams.set("error", "forbidden");
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  },
  {
    callbacks: {
      authorized: ({ token }) => !!token,
    },
    pages: {
      signIn: "/login",
    },
  }
);

export const config = {
  matcher: [
    "/orders/:path*",
    "/retail/:path*",
    "/clients/:path*",
    "/plans/:path*",
    "/forecast/:path*",
    "/sales/:path*",
    "/finance/:path*",
    "/warehouse/:path*",
    "/analytics/:path*",
    "/prices/:path*",
    "/admin/:path*",
  ],
};
