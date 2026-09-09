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
    // Роль и производство перечитываются из таблицы при каждом обновлении
    // токена — иначе права нельзя было бы менять на ходу.
    //
    // Важна ветка else: раньше её не было, и если строку сотрудника удаляли из
    // Users или ставили Active=FALSE, токен СОХРАНЯЛ прежнюю роль. Уволенный
    // продолжал работать до истечения токена (по умолчанию 30 дней), а
    // понижение из admin в manager не срабатывало, пока человек сам не выйдет.
    // Теперь у такого пользователя роль обнуляется, и middleware отправляет его
    // на вход: список сотрудников в таблице снова означает то, что обещает.
    async jwt({ token, user }) {
      const email = token.email ?? user?.email;
      if (email) {
        const appUser = await getUserByEmail(email);
        if (appUser && appUser.active) {
          token.role = appUser.role;
          token.farm = appUser.farm ?? null;
          token.name = appUser.name || token.name;
        } else {
          token.role = undefined;
          token.farm = null;
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        // Роли по умолчанию БОЛЬШЕ НЕТ. Раньше здесь стояло `?? "manager"`, и
        // пустая или опечатанная ячейка Role давала права менеджера: заводить
        // заявки, подтверждать их, подавать рекламации. Ошибка в таблице должна
        // закрывать доступ, а не открывать.
        session.user.role = (token.role as string) ?? "";
        session.user.farm = (token.farm as string | null) ?? null;
      }
      return session;
    },
  },
};
