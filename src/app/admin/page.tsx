import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { listUsers } from "@/lib/repo/users";
import { getSettings } from "@/lib/repo/settings";
import StaffForm from "@/components/StaffForm";
import ShelfLifeForm from "@/components/ShelfLifeForm";
import PageHeader from "@/components/PageHeader";
import Section from "@/components/Section";
import { saveShelfLifeAction, saveStaffAction } from "./actions";
import DigestForm from "@/components/DigestForm";
import BotSalesPhonesForm from "@/components/BotSalesPhonesForm";
import { BOT_SALES_SETTING } from "@/lib/botSalesAlert";
import Hint from "@/components/Hint";
import { settingsMap } from "@/lib/repo/broadcasts";
import { leadsLine, listWaLines } from "@/lib/repo/waLines";
import { listWaMessages } from "@/lib/repo/talks";
import WaLinesAdmin from "@/components/WaLinesAdmin";
import { lineHookKey } from "@/lib/secretBox";
import { DIGEST_SETTING } from "@/lib/morningDigest";
import { DIGEST_LAST_RUN } from "@/lib/morningDigestRunner";
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
    does: "Заявки на наши магазины в Алматы",
    farm: "не нужна",
  },
  {
    code: "retail_regions",
    does: "Заявки на наши магазины в регионах",
    farm: "не нужна",
  },
  {
    code: "office",
    does: "Подсклад «Офис»: остатки, отгрузка офисных заявок, списание — все цветы",
    farm: "не нужна",
  },
  {
    code: "office_retail",
    does: "Склад офиса и заявки на наши магазины Алматы",
    farm: "не нужна",
  },
  {
    code: "leadgen",
    does: "Лиды с рекламы: заводит, доводит и передаёт менеджерам",
    farm: "не нужна",
  },
  {
    code: "payroll",
    does: "Только раздел «Зарплата»; что именно можно — роль в самом разделе (Зарплата → Доступ)",
    farm: "не нужна",
  },
];

export default async function AdminPage({ searchParams }: { searchParams?: { tab?: string } }) {
  // Настройки вкладками, а не лентой на пять экранов (19.10.2026, владелец: «одностраничный и удобный»).
  const tab = ["staff", "wa", "farms", "notify"].includes(searchParams?.tab ?? "") ? searchParams!.tab! : "staff";
  const [session, users, settings, map, waLines, waMessages] = await Promise.all([
    getServerSession(authOptions),
    listUsers(),
    getSettings(),
    settingsMap(),
    listWaLines({ fresh: true }),
    listWaMessages({ lines: "all" }),
  ]);
  const nameOf = (e: string) => users.find((u) => u.email.toLowerCase() === e)?.name || "";
  const lineRows = waLines.map((l) => ({
    code: l.code,
    managerEmail: l.managerEmail,
    managerName: nameOf(l.managerEmail),
    label: l.label,
    phone: l.phone,
    state: l.tokenEnc ? l.state : "nokey",
    stateAt: l.stateAt,
    active: l.active,
    assistant: l.assistant,
    hasKey: !!l.tokenEnc,
    messages: waMessages.filter((m) => m.line === l.code).length,
    // Адрес уведомлений одной строкой — вставить в кабинет Green API, если CRM не смогла прописать его сама.
    hookUrl: `${(process.env.NEXTAUTH_URL || "https://www.crm-ecoculture.kz").replace(/\/+$/, "")}/api/whatsapp/webhook?line=${encodeURIComponent(l.code)}&key=${lineHookKey(l.code)}`,
  }));
  // Номер Земфиры: ключи в переменных сайта, режим ИИ — настройкой `LeadsAssistant` (20.10.2026).
  const zemfira = await leadsLine();
  const leadsRow = zemfira ? { ownerName: nameOf(zemfira.managerEmail), assistant: zemfira.assistant === "on" ? ("on" as const) : ("off" as const), messages: waMessages.filter((m) => m.line === "leads").length } : null;
  const lineManagers = users
    .filter((u) => u.active && ["manager", "sales_head", "admin", "leadgen"].includes(u.role))
    .map((u) => ({ email: u.email.toLowerCase(), name: u.name }))
    .sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email, "ru"));

  return (
    <div className="space-y-6">
      <PageHeader area="admin" title="Настройки" icon="gear" />

      <nav className="flex flex-wrap gap-2 -mt-1">
        {(
          [
            ["staff", "Сотрудники и роли"],
            ["wa", "WhatsApp менеджеров"],
            ["farms", "Производства и сроки"],
            ["notify", "Сводка и уведомления"],
          ] as const
        ).map(([key, label]) => (
          <Link
            key={key}
            href={key === "staff" ? "/admin" : `/admin?tab=${key}`}
            className={
              tab === key
                ? "h-9 px-4 rounded-full bg-ink-primary text-white text-sm font-medium grid place-items-center"
                : "h-9 px-4 rounded-full border border-line-hairline bg-surface text-sm text-ink-secondary hover:text-ink-primary grid place-items-center"
            }
          >
            {label}
          </Link>
        ))}
      </nav>

      {tab === "staff" && (

      <Section tone="admin" icon="client" title="Сотрудники и роли" className="!mb-0">
        <p className="text-sm text-ink-secondary mb-3">Права меняются в течение минуты.</p>

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
        <div className="table-scroll table-cards mb-5 border border-line-hairline rounded-lg">
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
                  <td data-label="Код роли" className="px-3 py-2">
                    <code>{r.code}</code>
                  </td>
                  <td data-label="Кто это" className="px-3 py-2">{ROLE_LABELS[r.code] ?? r.code}</td>
                  <td data-label="Что делает в системе" className="px-3 py-2 text-ink-secondary">{r.does}</td>
                  <td data-label="Колонка Farm" className="px-3 py-2 text-ink-secondary">{r.farm}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
          </div>
        </details>
      </Section>
      )}

      {tab === "wa" && (
      <Section
        tone="leads"
        icon="message"
        title={
          <span className="inline-flex items-center">
            WhatsApp менеджеров
            <Hint>
              У каждого менеджера свой номер, подключённый к Green API. Его переписка видна в «Клиенты → Переписки», новые
              номера, написавшие менеджеру, сами становятся его лидами, ИИ разбирает разговоры, а ИИ-помощник подсказывает
              ответы и отвечает сам, когда клиент ждёт дольше 20 минут, вечером и в выходные.
            </Hint>
          </span>
        }
        className="!mb-0"
      >
        <WaLinesAdmin lines={lineRows} managers={lineManagers} leads={leadsRow} />
      </Section>
      )}

      {tab === "farms" && (
      <div className="grid gap-6 xl:grid-cols-2 items-start">
      <Section tone="admin" icon="leaf" title="Производства" className="!mb-0">
        <p className="text-sm text-ink-secondary mb-3">Зав. складом видит только свой цветок.</p>
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
      </Section>

      <Section tone="stock" icon="clock" title="Сроки хранения" className="!mb-0">
        <p className="text-sm text-ink-secondary mb-4">Сколько дней цветок считается годным.</p>
        <ShelfLifeForm
          days={settings.shelfLifeDays}
          warningPercent={Math.round(settings.warningThreshold * 100)}
          save={saveShelfLifeAction}
        />
      </Section>
      </div>
      )}

      {tab === "notify" && (
      <div className="grid gap-6 xl:grid-cols-2 items-start">
      <Section
        tone="admin"
        icon="message"
        title={
          <>
            Утренняя сводка в WhatsApp{" "}
            <Hint>
              Каждое утро около 9:00 с рабочего номера приходит сводка: вчерашние заявки и деньги, точка на базаре,
              что отгружать сегодня, долги и «требует внимания» с главной. Пустое поле — сводка не приходит.
            </Hint>
          </>
        }
        className="!mb-0"
      >
        <DigestForm initial={map[DIGEST_SETTING] ?? ""} />
        <p className="text-xs text-ink-muted mt-3">
          Последняя отправка: {map[DIGEST_LAST_RUN] || "ещё не было"}
        </p>
      </Section>

      <Section
        tone="admin"
        icon="message"
        title={
          <>
            Продажи бота в WhatsApp{" "}
            <Hint>
              Когда бот оформил заказ — приходит сообщение: клиент, позиции, сумма, доставка, склад и что со счётом
              Kaspi. Когда клиент оплатил — второе: «оплачено, можно собирать». Бот этим номерам не отвечает. Пустое
              поле — сообщения не приходят.
            </Hint>
          </>
        }
        className="!mb-0"
      >
        <BotSalesPhonesForm initial={map[BOT_SALES_SETTING] ?? ""} />
      </Section>
      </div>
      )}
    </div>
  );
}
