/** @type {import('next').NextConfig} */

// Боевой адрес сайта. Он же прописан в NEXTAUTH_URL на Vercel и в настройках
// Google OAuth. Если домен когда-нибудь сменится — менять надо во всех трёх местах.
//
// Почему с «www», а не просто crm-ecoculture.kz: на стороне Vercel домен без www
// уже отдаёт постоянную (308) переадресацию на www, и отменить её из кода нельзя.
// Постоянную переадресацию браузеры кешируют надолго, поэтому спорить с ней
// бессмысленно — правильнее принять www за основной адрес и вести всё туда.
// Человеку разницы нет: он набирает crm-ecoculture.kz и попадает куда надо.
const SITE = "https://www.crm-ecoculture.kz";

// Старый служебный адрес Vercel уводим на домен, чтобы в адресной строке у
// сотрудников был crm-ecoculture.kz, а не ecoculture-crm.vercel.app.
// Домен без www сюда добавлять НЕЛЬЗЯ: Vercel и так шлёт его на www, и пара
// правил навстречу друг другу даёт бесконечное кольцо переадресаций.
const OLD_HOSTS = ["ecoculture-crm.vercel.app"];

const nextConfig = {
  reactStrictMode: true,
  async redirects() {
    // Переадресация временная (307), а не постоянная: постоянную браузеры
    // запоминают намертво, и если адрес придётся менять — люди будут месяцами
    // попадать на старый из кеша.
    return OLD_HOSTS.map((host) => ({
      source: "/:path*",
      has: [{ type: "host", value: host }],
      destination: `${SITE}/:path*`,
      permanent: false,
    }));
  },
  async headers() {
    // Защитные заголовки. Главный здесь — Strict-Transport-Security: он говорит
    // браузеру «этот сайт открывать только по https, и поддомены тоже».
    // После первого захода браузер сам подставляет https, даже если человек
    // набрал адрес без него, — и подменить страницу по дороге уже нельзя.
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          // Запрещаем открывать CRM внутри чужого сайта в рамке — так подделывают
          // страницы входа.
          { key: "X-Frame-Options", value: "DENY" },
          // Браузер не должен «угадывать» тип файла вопреки заголовку.
          { key: "X-Content-Type-Options", value: "nosniff" },
          // При переходе на сторонний сайт не отдаём адрес страницы, с которой
          // ушли: в нём бывают номера заявок.
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
  experimental: {
    serverActions: {
      // Файлы приёмки из теплицы — небольшие, но запас не мешает.
      bodySizeLimit: "8mb",
    },
  },
};

module.exports = nextConfig;
