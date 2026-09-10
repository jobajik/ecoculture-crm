import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";

// Кто какие разделы может открывать. "admin" по умолчанию имеет доступ всюду.
const ROLE_ACCESS: { prefix: string; roles: string[] }[] = [
  // Собственная розница. Менеджеры розницы живут в своём разделе и в заявках;
  // клиентская база, деньги, планы и склад им не нужны и закрыты.
  { prefix: "/retail", roles: ["retail_almaty", "retail_regions", "sales_head", "admin"] },
  { prefix: "/orders/new", roles: ["manager", "retail_almaty", "retail_regions", "admin"] },
  { prefix: "/warehouse", roles: ["warehouse", "admin"] },
  // Рекламацию заводит менеджер, а решение по ней видит у бухгалтера. Раньше
  // весь /finance был закрыт от менеджера, и он не мог узнать, чем кончилась
  // его же жалоба, хотя страница /finance/claims его пускала.
  { prefix: "/finance/claims", roles: ["accountant", "manager", "sales_head", "admin"] },
  { prefix: "/finance", roles: ["accountant", "admin"] },
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
