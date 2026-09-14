import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { listUsers } from "@/lib/repo/users";
import { getSettings } from "@/lib/repo/settings";
import StaffForm from "@/components/StaffForm";
import ShelfLifeForm from "@/components/ShelfLifeForm";
import { saveShelfLifeAction, saveStaffAction } from "./actions";
import {
  FARM_ORDER,
  FLOWER_TYPE_LABELS,
  FLOWER_TYPES_BY_FARM,
  ROLE_LABELS,
  farmLabel,
  isFarmBoundRole,
} from "@/lib/constants";

export const dynamic = "force-dynamic";

/**
 * Шпаргалка по ролям для того, кто ведёт вкладку Users. Держим её в интерфейсе,
 * а не в инструкции: инструкцию не найдут, а эта страница у владельца под рукой.
 */
const ROLE_GUIDE: { code: string; does: string; farm: string }[] = [
  {
    code: "admin",
    does: "Видит и может всё, включая эти настройки",
    farm: "не нужна",
  },
  {
    code: "manager",
    does: "Принимает заявки, видит свой рейтинг и бонусы",
    farm: "не нужна",
  },
  {
    code: "sales_head",
    does: "Ставит планы менеджерам и план отгрузок по направлениям, видит продажи",
    farm: "не нужна",
  },
  {
    code: "warehouse",
    does: "Приёмка, отгрузка, списание и лист сборки по своему цветку",
    farm: "обязательна",
  },
  {
    code: "agronomist",
    does: "Ведёт прогноз срезки (ростовку) по своему цветку",
    farm: "обязательна",
  },
  {
    code: "accountant",
    does: "Отмечает оплаты, ведёт долги и выгружает отчёт",
    farm: "не нужна",
  },
  {
    code: "retail_almaty",
    does: "Собирает заявки на НАШИ магазины в Алматы. Оплата по ним не проводится — это внутреннее перемещение, и отгрузку открывает его подтверждение",
    farm: "не нужна",
  },
  {
    code: "retail_regions",
    does: "То же самое по нашим магазинам в регионах. Направления разделены жёстко: чужие магазины он не видит",
    farm: "не нужна",
  },
];

export default async function AdminPage() {
  const [session, users, settings] = await Promise.all([
    getServerSession(authOptions),
    listUsers(),
    getSettings(),
  ]);

  return (
    <div className="space-y-6 max-w-5xl">
      <h1 className="text-xl font-semibold">Настройки</h1>

      <div className="card">
        <h2 className="font-medium mb-1">Сотрудники и роли</h2>
        <p className="text-sm text-ink-secondary mb-3">
          Принять человека, сменить ему роль или закрыть доступ уволенному — прямо здесь. Раньше для
          этого приходилось открывать Google-таблицу и вписывать строку руками; таблица никуда не
          делась и остаётся аварийным выходом, но обычный путь теперь этот. Новое право начинает
          действовать в течение минуты, перезапускать ничего не нужно. Ниже — что делает каждая роль.
        </p>

        <StaffForm
          users={users}
          actorEmail={session?.user?.email ?? ""}
          save={saveStaffAction}
        />

        <details className="mt-5">
          {/* Справочник ролей нужен раз в месяц, а форма — каждый раз. Поэтому
              он ушёл вниз и свёрнут: раскрытая таблица на восемь строк стояла
              между заголовком и тем, ради чего сюда приходят. */}
          <summary className="cursor-pointer text-sm text-ink-secondary">
            Что делает каждая роль
          </summary>
          <div className="mt-3">
        <div className="overflow-x-auto mb-5 border border-line-hairline rounded-lg">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-ink-secondary border-b border-line-hairline bg-surface-plane">
                <th className="px-3 py-2 font-medium">Код роли</th>
                <th className="px-3 py-2 font-medium">Кто это</th>
                <th className="px-3 py-2 font-medium">Что делает в системе</th>
                <th className="px-3 py-2 font-medium">Колонка Farm</th>
              </tr>
            </thead>
            <tbody>
              {ROLE_GUIDE.map((r) => (
                <tr key={r.code} className="border-b border-line-hairline last:border-0">
                  <td className="px-3 py-2">
                    <code>{r.code}</code>
                  </td>
                  <td className="px-3 py-2">{ROLE_LABELS[r.code] ?? r.code}</td>
                  <td className="px-3 py-2 text-ink-secondary">{r.does}</td>
                  <td className="px-3 py-2 text-ink-secondary">{r.farm}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
          </div>
        </details>
      </div>

      <div className="card">
        <h2 className="font-medium mb-1">Производства</h2>
        <p className="text-sm text-ink-secondary mb-3">
          У каждого производства свой зав. складом: он видит остатки, принимает партии и отгружает
          только свой цветок. Менеджеры и администратор работают по обоим.
        </p>
        <div className="grid sm:grid-cols-2 gap-3">
          {FARM_ORDER.map((f) => (
            <div key={f} className="border border-line-hairline rounded-lg p-3">
              <div className="font-medium">{farmLabel(f)}</div>
              <div className="text-sm text-ink-secondary">
                {FLOWER_TYPES_BY_FARM[f]?.map((t) => FLOWER_TYPE_LABELS[t]).join(", ")}
              </div>
              <div className="text-xs text-ink-muted mt-1">
                код для колонки Farm: <code>{f}</code>
              </div>
              <div className="text-xs text-ink-muted mt-1">
                зав. складом:{" "}
                {users
                  .filter((u) => u.role === "warehouse" && u.farm === f && u.active)
                  .map((u) => u.name || u.email)
                  .join(", ") || "не назначен"}
              </div>
              <div className="text-xs text-ink-muted mt-1">
                агроном:{" "}
                {users
                  .filter((u) => u.role === "agronomist" && u.farm === f && u.active)
                  .map((u) => u.name || u.email)
                  .join(", ") || "не назначен"}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <h2 className="font-medium mb-1">Сроки хранения</h2>
        <p className="text-sm text-ink-secondary mb-4">
          Сколько дней цветок считается годным. Это решение хозяйства, а не настройка программы,
          поэтому меняется здесь. От этих чисел красится весь склад и считается, на сколько дней
          хватит запаса.
        </p>
        <ShelfLifeForm
          days={settings.shelfLifeDays}
          warningPercent={Math.round(settings.warningThreshold * 100)}
          save={saveShelfLifeAction}
        />
      </div>
    </div>
  );
}
