import { listUsers } from "@/lib/repo/users";
import { getSettings } from "@/lib/repo/settings";
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
];

export default async function AdminPage() {
  const [users, settings] = await Promise.all([listUsers(), getSettings()]);

  return (
    <div className="space-y-6 max-w-3xl">
      <h1 className="text-xl font-semibold">Настройки</h1>

      <div className="card">
        <h2 className="font-medium mb-1">Сотрудники и роли</h2>
        <p className="text-sm text-ink-secondary mb-3">
          Список сотрудников и их роли хранятся на вкладке <b>Users</b> вашей Google-таблицы. Чтобы
          добавить сотрудника, дать или забрать доступ — отредактируйте эту вкладку напрямую:
          добавьте строку с его Google-почтой, именем, кодом роли из таблицы ниже,{" "}
          <code>TRUE</code> в колонке Active и производством в последней колонке <b>Farm</b>.
          Изменения применяются сразу при следующем входе сотрудника. Нового человека нужно ещё
          добавить в тестовые пользователи Google — иначе он не войдёт.
        </p>

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
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-ink-secondary border-b border-line-hairline">
                <th className="px-3 py-2 font-medium">Email</th>
                <th className="px-3 py-2 font-medium">Имя</th>
                <th className="px-3 py-2 font-medium">Роль</th>
                <th className="px-3 py-2 font-medium">Производство</th>
                <th className="px-3 py-2 font-medium">Активен</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.email} className="border-b border-line-hairline last:border-0">
                  <td className="px-3 py-2">{u.email}</td>
                  <td className="px-3 py-2">{u.name}</td>
                  <td className="px-3 py-2">{ROLE_LABELS[u.role] ?? u.role}</td>
                  <td className="px-3 py-2 text-ink-secondary">
                    {isFarmBoundRole(u.role) ? (
                      u.farm ? (
                        farmLabel(u.farm)
                      ) : (
                        <span className="text-status-critical">не задано</span>
                      )
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-3 py-2">{u.active ? "Да" : "Нет"}</td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-ink-muted">
                    Пользователи не найдены — добавьте их на вкладке Users
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
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
          Задаются на вкладке <b>Settings</b> ключами вида <code>ShelfLifeDays_rose</code>,{" "}
          <code>ShelfLifeDays_chrysanthemum</code> (в сутках) и <code>WarningThresholdPercent</code> — с
          какой доли от максимального срока партия помечается жёлтым (&quot;требует внимания&quot;), до
          100% (просрочена). Сейчас используются такие значения:
        </p>
        <ul className="text-sm space-y-1">
          {Object.entries(settings.shelfLifeDays).map(([flowerType, days]) => (
            <li key={flowerType}>
              {FLOWER_TYPE_LABELS[flowerType] ?? flowerType}: <b>{days}</b> дней
            </li>
          ))}
          <li>
            Порог предупреждения: <b>{Math.round(settings.warningThreshold * 100)}%</b> от срока
          </li>
        </ul>
      </div>
    </div>
  );
}
