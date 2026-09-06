import type { AuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { getUserByEmail } from "./repo/users";

export const authOptions: AuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID as string,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
    }),
  ],
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
    error: "/login",
  },
  callbacks: {
    // Пускаем в систему только тех, чей email внесён в лист Users и активен.
    // Так владелец компании полностью контролирует список сотрудников —
    // просто добавляя/убирая строки в таблице, без правок кода.
    async signIn({ user }) {
      if (!user.email) return false;
      const appUser = await getUserByEmail(user.email);
      if (!appUser || !appUser.active) {
        return "/login?error=AccessDenied";
      }
      return true;
    },
    async jwt({ token, user }) {
      const email = token.email ?? user?.email;
      if (email) {
        const appUser = await getUserByEmail(email);
        if (appUser) {
          token.role = appUser.role;
          token.farm = appUser.farm ?? null;
          token.name = appUser.name || token.name;
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.role = (token.role as string) ?? "manager";
        session.user.farm = (token.farm as string | null) ?? null;
      }
      return session;
    },
  },
};
