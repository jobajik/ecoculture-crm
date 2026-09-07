import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";

// Кто какие разделы может открывать. "admin" по умолчанию имеет доступ всюду.
const ROLE_ACCESS: { prefix: string; roles: string[] }[] = [
  { prefix: "/orders/new", roles: ["manager", "admin"] },
  { prefix: "/warehouse", roles: ["warehouse", "admin"] },
  { prefix: "/finance", roles: ["accountant", "admin"] },
  { prefix: "/sales", roles: ["manager", "admin", "accountant"] },
  { prefix: "/admin", roles: ["admin"] },
];

export default withAuth(
  function middleware(req) {
    const role = (req.nextauth.token?.role as string) ?? "manager";
    if (role === "admin") return NextResponse.next();

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
    "/sales/:path*",
    "/finance/:path*",
    "/warehouse/:path*",
    "/analytics/:path*",
    "/admin/:path*",
  ],
};
