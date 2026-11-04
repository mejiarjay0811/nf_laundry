import type { ReactNode } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatChartDate } from '@shared/datetime';
import { peso, pesoCompact } from '@/lib/format';
import { EmptyState } from '@/components/ui/States';

/**
 * A single categorical palette, used everywhere, so a colour means the same
 * thing on every chart in the app.
 */
export const SERIES_COLORS = ['#2589f0', '#0f766e', '#a855f7', '#f59e0b', '#ef4444', '#64748b'];

export const STATUS_COLORS: Record<string, string> = {
  Paid: '#059669',
  'Partially Paid': '#d97706',
  Unpaid: '#dc2626',
  Refunded: '#7c3aed',
  Cancelled: '#64748b',
  Ready: '#059669',
  Pending: '#64748b',
  'Picked Up': '#2589f0',
  Cash: '#0f766e',
  GCash: '#2589f0',
};

const axisProps = {
  stroke: '#94a3b8',
  fontSize: 11,
  tickLine: false,
  axisLine: false,
};

function ChartFrame({ height = 260, children }: { height?: number; children: ReactNode }) {
  return (
    <div style={{ width: '100%', height }}>
      <ResponsiveContainer width="100%" height="100%">
        {children as never}
      </ResponsiveContainer>
    </div>
  );
}

const tooltipStyle = {
  contentStyle: {
    borderRadius: 10,
    border: '1px solid #e2e8f0',
    fontSize: 12,
    boxShadow: '0 8px 24px -8px rgb(15 23 42 / 0.25)',
  },
};

export function SalesTrendChart({
  data,
  height,
}: {
  data: Array<{ dateKey: string; sales: number; transactions?: number }>;
  height?: number;
}) {
  if (data.length === 0) {
    return <EmptyState title="No sales in this period." />;
  }
  return (
    <ChartFrame height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="salesFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2589f0" stopOpacity={0.28} />
            <stop offset="100%" stopColor="#2589f0" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
        <XAxis dataKey="dateKey" tickFormatter={formatChartDate} {...axisProps} minTickGap={20} />
        <YAxis tickFormatter={(value: number) => pesoCompact(value)} width={62} {...axisProps} />
        <Tooltip
          {...tooltipStyle}
          formatter={(value: number) => [peso(value), 'Sales']}
          labelFormatter={(label: string) => formatChartDate(label)}
        />
        <Area
          type="monotone"
          dataKey="sales"
          stroke="#2589f0"
          strokeWidth={2}
          fill="url(#salesFill)"
        />
      </AreaChart>
    </ChartFrame>
  );
}

export function GroupedBarChart({
  data,
  bars,
  xKey,
  xFormatter,
  height,
}: {
  data: Array<Record<string, string | number>>;
  bars: Array<{ key: string; label: string; color: string }>;
  xKey: string;
  xFormatter?: (value: string) => string;
  height?: number;
}) {
  if (data.length === 0) return <EmptyState title="Nothing to chart yet." />;
  return (
    <ChartFrame height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
        <XAxis dataKey={xKey} tickFormatter={xFormatter} {...axisProps} minTickGap={12} />
        <YAxis tickFormatter={(value: number) => pesoCompact(value)} width={62} {...axisProps} />
        <Tooltip {...tooltipStyle} formatter={(value: number) => peso(value)} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        {bars.map((bar) => (
          <Bar
            key={bar.key}
            dataKey={bar.key}
            name={bar.label}
            fill={bar.color}
            radius={[3, 3, 0, 0]}
            maxBarSize={38}
          />
        ))}
      </BarChart>
    </ChartFrame>
  );
}

export function DonutChart({
  data,
  height = 240,
  valueFormatter = (value: number) => String(value),
}: {
  data: Array<{ name: string; value: number }>;
  height?: number;
  valueFormatter?: (value: number) => string;
}) {
  const total = data.reduce((sum, item) => sum + item.value, 0);
  if (total === 0) return <EmptyState title="No data for this period." />;

  return (
    <ChartFrame height={height}>
      <PieChart>
        <Pie
          data={data}
          dataKey="value"
          nameKey="name"
          innerRadius="58%"
          outerRadius="82%"
          paddingAngle={2}
          stroke="none"
        >
          {data.map((entry, index) => (
            <Cell
              key={entry.name}
              fill={STATUS_COLORS[entry.name] ?? SERIES_COLORS[index % SERIES_COLORS.length]}
            />
          ))}
        </Pie>
        <Tooltip {...tooltipStyle} formatter={(value: number) => valueFormatter(value)} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
      </PieChart>
    </ChartFrame>
  );
}
