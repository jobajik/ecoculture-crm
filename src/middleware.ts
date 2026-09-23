import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";
import { accessRuleFor, missingFarm } from "@/lib/access";

// Кто какие разделы может открывать. "admin" по умолчанию имеет доступ всюду.

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
    // Склад и прогноз без производства в карточке не открываются вовсе: пустое
    // производство раньше читалось как «все» (см. `missingFarm`).
    if (
      (path.startsWith("/warehouse") || path.startsWith("/forecast")) &&
      missingFarm(role, req.nextauth.token?.farm as string | null | undefined)
    ) {
      const url = req.nextUrl.clone();
      url.pathname = "/";
      url.searchParams.set("error", "nofarm");
      return NextResponse.redirect(url);
    }
    const rule = accessRuleFor(path);
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
