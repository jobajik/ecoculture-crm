import type { ReactNode } from "react";

export default function ChartCard({
  title,
  description,
  children,
  height = 280,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  height?: number;
}) {
  return (
    <div className="card">
      <div className="mb-3">
        <h3 className="font-medium">{title}</h3>
        {description && <p className="text-xs text-ink-muted mt-0.5">{description}</p>}
      </div>
      <div style={{ width: "100%", height }}>{children}</div>
    </div>
  );
}

// Общие константы для оформления графиков (см. skill dataviz/references/palette.md)
export const CHART_COLORS = {
  series1: "#2a78d6",
  series2: "#eb6834",
  series3: "#1baf7a",
  series4: "#eda100",
  series5: "#e87ba4",
  series6: "#008300",
  series7: "#4a3aa7",
  series8: "#e34948",
  grid: "#e1e0d9",
  axis: "#898781",
  textSecondary: "#52514e",
  surface: "#fcfcfb",
};

export const CATEGORICAL_ORDER = [
  CHART_COLORS.series1,
  CHART_COLORS.series2,
  CHART_COLORS.series3,
  CHART_COLORS.series4,
  CHART_COLORS.series5,
  CHART_COLORS.series6,
  CHART_COLORS.series7,
  CHART_COLORS.series8,
];

export const tooltipStyle = {
  background: "#ffffff",
  border: `1px solid ${CHART_COLORS.grid}`,
  borderRadius: 8,
  fontSize: 12,
  color: "#0b0b0b",
};
