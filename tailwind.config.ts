import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/app/**/*.{ts,tsx}", "./src/components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Фирменный акцент Ecoculture — глубокий зелёный. Намеренно отличается
        // от «зелёного статуса» (status.good), чтобы кнопка никогда не читалась
        // как индикатор состояния.
        accent: {
          DEFAULT: "#0f7a52",
          hover: "#0c6644",
          soft: "#e7f3ed",
        },
        surface: {
          DEFAULT: "#ffffff",
          plane: "#f7f8f6",
          sunk: "#eef1ec",
        },
        ink: {
          primary: "#161a17",
          secondary: "#5a6159",
          muted: "#8b918a",
        },
        line: {
          hairline: "#e7eae4",
          strong: "#d3d8cf",
        },
        // Палитра графиков (проверена на контраст и различимость при дальтонизме)
        series: {
          1: "#2a78d6",
          2: "#eb6834",
          3: "#1baf7a",
          4: "#eda100",
          5: "#e87ba4",
          6: "#008300",
          7: "#4a3aa7",
          8: "#e34948",
        },
        // Цвет цветка — только чтобы отличить блоки друг от друга. Нарочно взяты
        // тона, далёкие от статусных зелёного/жёлтого/красного: цвет состояния
        // должен оставаться единственным, который что-то означает. Используются
        // приглушённо — полоска слева и точка в заголовке, не заливка строк.
        flower: {
          rose: "#c2557a",
          chrysanthemum: "#2f7d94",
          eustoma: "#6b5ec4",
        },
        status: {
          good: "#0ca30c",
          warning: "#fab219",
          serious: "#ec835a",
          critical: "#d03b3b",
        },
      },
      fontFamily: {
        sans: ["Arimo", "Helvetica Neue", "Arial", "sans-serif"],
      },
      borderRadius: {
        xl: "14px",
        "2xl": "18px",
      },
      boxShadow: {
        card: "0 1px 2px rgba(22, 26, 23, 0.04), 0 1px 3px rgba(22, 26, 23, 0.03)",
        "card-hover": "0 2px 4px rgba(22, 26, 23, 0.06), 0 8px 20px -12px rgba(22, 26, 23, 0.18)",
      },
    },
  },
  plugins: [],
};

export default config;
