import type { AuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { getUserByEmail } from "./repo/users";
import { roleForToken, type RoleLookup } from "./authRole";

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
    // токена — иначе права нельзя было бы менять на ходу. А обновляется он не
    // раз в полчаса, как кажется, а при КАЖДОЙ отрисовке страницы: этот
    // обработчик зовёт сам `getServerSession()`. Отсюда две вещи: чтение
    // вкладки Users кэшируется на минуту (repo/users.ts), а неответ таблицы не
    // считается увольнением (authRole.ts).
    //
    // Важна ветка else: раньше её не было, и если строку сотрудника удаляли из
    // Users или ставили Active=FALSE, токен СОХРАНЯЛ прежнюю роль. Уволенный
    // продолжал работать до истечения токена (по умолчанию 30 дней), а
    // понижение из admin в manager не срабатывало, пока человек сам не выйдет.
    // Теперь у такого пользователя роль обнуляется, и middleware отправляет его
    // на вход: список сотрудников в таблице снова означает то, что обещает.
    async jwt({ token, user }) {
      const email = token.email ?? user?.email;
      if (!email) return token;

      // Таблица отвечает не всегда: лимиты Google, сеть, секундная
      // недоступность. Неответ — это НЕ «сотрудника уволили», и путать одно с
      // другим нельзя: на этом бухгалтер Юлия получила страницу оплат без
      // единой кнопки (подробности и правило — в src/lib/authRole.ts).
      let lookup: RoleLookup;
      try {
        const appUser = await getUserByEmail(email);
        lookup = { ok: true, user: appUser };
      } catch (error) {
        console.error("Не удалось перечитать роль из таблицы:", error);
        lookup = { ok: false };
      }

      const next = roleForToken(
        {
          role: token.role as string | undefined,
          farm: (token.farm as string | null) ?? null,
          name: token.name ?? undefined,
        },
        lookup
      );
      token.role = next.role;
      token.farm = next.farm;
      token.name = next.name;
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
