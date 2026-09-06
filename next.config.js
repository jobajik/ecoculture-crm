/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverActions: {
      // Файлы приёмки из теплицы — небольшие, но запас не мешает.
      bodySizeLimit: "8mb",
    },
  },
};

module.exports = nextConfig;
