import Link from "next/link";
import type { Metadata } from "next";

/**
 * Политика конфиденциальности — публичная страница, без входа.
 *
 * Нужна не «для галочки»: без ссылки на неё Google не выпускает приложение из
 * режима «Тестирование», а пока оно там, токен доступа к таблице умирает каждые
 * семь дней и CRM перестаёт видеть данные. Плюс это честно: сотрудники входят
 * своим Google-аккаунтом и вправе знать, что именно система о них берёт.
 *
 * Страница намеренно вне middleware (в matcher её нет) — иначе Google увидел бы
 * вместо политики страницу входа.
 */

export const metadata: Metadata = {
  title: "Политика конфиденциальности — Ecoculture-CRM",
  description: "Какие данные собирает Ecoculture-CRM и как они используются",
};

const UPDATED = "8 сентября 2026 года";
const CONTACT = "y.sadakbayev@gmail.com";

export default function PrivacyPage() {
  return (
    <div className="max-w-2xl mx-auto py-4">
      <h1 className="text-2xl font-semibold mb-1">Политика конфиденциальности</h1>
      <p className="text-sm text-ink-muted mb-8">Ecoculture-CRM · обновлено {UPDATED}</p>

      <div className="space-y-6 text-[15px] leading-relaxed">
        <section>
          <h2 className="font-semibold mb-1.5">Что это за система</h2>
          <p className="text-ink-secondary">
            Ecoculture-CRM — внутренняя рабочая система тепличного хозяйства для учёта срезки,
            складских остатков, заявок клиентов и отгрузок. Ею пользуются только сотрудники
            хозяйства. Это не публичный сервис: посторонний человек, даже войдя через Google, не
            получит доступа — его почты нет в списке сотрудников, и система его не пустит.
          </p>
        </section>

        <section>
          <h2 className="font-semibold mb-1.5">Какие данные о вас берутся при входе</h2>
          <p className="text-ink-secondary mb-2">
            Вход выполняется через Google. От Google система получает и использует только три вещи:
          </p>
          <ul className="text-ink-secondary space-y-1 list-disc pl-5">
            <li>
              <b>адрес электронной почты</b> — по нему система узнаёт сотрудника и определяет его
              роль и производство;
            </li>
            <li>
              <b>имя</b> — чтобы показывать, кто оформил заявку или принял партию;
            </li>
            <li>
              <b>идентификатор аккаунта Google</b> — технический признак, что это тот же человек.
            </li>
          </ul>
          <p className="text-ink-secondary mt-2">
            Пароль от Google система не видит и не хранит: вход происходит на стороне Google.
            Доступа к вашей почте, файлам, контактам или календарю система не запрашивает.
          </p>
        </section>

        <section>
          <h2 className="font-semibold mb-1.5">Какие рабочие данные хранятся</h2>
          <p className="text-ink-secondary">
            Партии цветка и сроки хранения, заявки клиентов и их позиции, отгрузки и списания,
            цены, планы продаж и прогнозы срезки. Это данные хозяйства, а не личные данные
            сотрудников; из личного там остаётся только почта того, кто внёс запись, — чтобы было
            видно авторство.
          </p>
        </section>

        <section>
          <h2 className="font-semibold mb-1.5">Где всё это лежит</h2>
          <p className="text-ink-secondary">
            Данные хранятся в Google-таблице, принадлежащей владельцу хозяйства. Само приложение
            размещено на Vercel. Никакой другой базы данных у системы нет, и никуда, кроме этих
            двух мест, данные не уходят.
          </p>
        </section>

        <section>
          <h2 className="font-semibold mb-1.5">Кому данные передаются</h2>
          <p className="text-ink-secondary">
            Никому. Данные не продаются, не передаются третьим лицам, не используются для рекламы и
            не анализируются на стороне. Доступ к системе имеют только сотрудники хозяйства, каждый
            в объёме своей роли: например, заведующий складом видит только цветок своего
            производства.
          </p>
        </section>

        <section>
          <h2 className="font-semibold mb-1.5">Сколько данные хранятся и как их удалить</h2>
          <p className="text-ink-secondary">
            Рабочие записи хранятся столько, сколько нужны хозяйству для учёта. Если вы перестали
            работать в хозяйстве и хотите, чтобы ваши учётные данные (почта и имя) были удалены,
            напишите на{" "}
            <a href={`mailto:${CONTACT}`} className="text-accent hover:underline">
              {CONTACT}
            </a>{" "}
            — доступ отзывается сразу, записи обезличиваются по запросу.
          </p>
        </section>

        <section>
          <h2 className="font-semibold mb-1.5">Как отозвать доступ самому</h2>
          <p className="text-ink-secondary">
            В любой момент можно отозвать разрешение, выданное этому приложению, в настройках
            своего аккаунта Google — раздел «Сторонние приложения и сервисы». После этого вход в
            систему перестанет работать.
          </p>
        </section>

        <section>
          <h2 className="font-semibold mb-1.5">Связаться</h2>
          <p className="text-ink-secondary">
            По любым вопросам об этой политике и о данных:{" "}
            <a href={`mailto:${CONTACT}`} className="text-accent hover:underline">
              {CONTACT}
            </a>
            .
          </p>
        </section>
      </div>

      <div className="mt-10 pt-4 border-t border-line-hairline">
        <Link href="/login" className="text-sm text-accent hover:underline">
          ← Вернуться ко входу
        </Link>
      </div>
    </div>
  );
}
