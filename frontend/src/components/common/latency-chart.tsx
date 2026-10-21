'use client';

import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { SeriesPoint } from '@/lib/types';
import { fmtMs } from '@/lib/format';

const tick = { fontSize: 11, fill: 'hsl(var(--muted-foreground))' };

/** Latency over time. Colours are CSS variables, so the chart (axes, grid, tooltip) follows the theme. */
export function LatencyChart({ series, bucketSeconds, thresholdMs, showP95 = false }: {
  series: SeriesPoint[]; bucketSeconds: number; thresholdMs?: number; showP95?: boolean;
}) {
  const points = series.filter((p) => p.avgMs != null);
  if (points.length < 2) {
    return (
      <div className="flex h-56 items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted-foreground">
        Not enough data yet. At least two time buckets with successful checks are needed to draw a trend.
      </div>
    );
  }
  const long = bucketSeconds >= 3600;
  const fmt = (t: number) => new Date(t).toLocaleString(undefined, long ? { month: 'short', day: 'numeric', hour: '2-digit', hour12: false } : { hour: '2-digit', minute: '2-digit', hour12: false });
  return (
    <div className="h-64 w-full" role="img" aria-label="Average response latency over time">
      <ResponsiveContainer>
        <AreaChart data={points} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="lat" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="hsl(var(--chart-1))" stopOpacity={0.3} />
              <stop offset="100%" stopColor="hsl(var(--chart-1))" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="hsl(var(--chart-grid))" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="t" tickFormatter={fmt} tick={tick} stroke="hsl(var(--border))" minTickGap={40} />
          <YAxis tick={tick} stroke="hsl(var(--border))" width={56} tickFormatter={(v) => `${v}ms`} />
          <Tooltip
            labelFormatter={(t) => fmt(Number(t))}
            formatter={(v: number, name: string) => [fmtMs(v), name === 'p95Ms' ? 'p95' : 'Average']}
            contentStyle={{ background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 8, color: 'hsl(var(--popover-foreground))', fontSize: 12 }}
            labelStyle={{ color: 'hsl(var(--muted-foreground))' }}
          />
          {thresholdMs != null && <ReferenceLine y={thresholdMs} stroke="hsl(var(--chart-2))" strokeDasharray="5 4" label={{ value: `threshold ${thresholdMs} ms`, position: 'insideTopRight', fill: 'hsl(var(--chart-2))', fontSize: 11 }} />}
          <Area type="monotone" dataKey="avgMs" stroke="hsl(var(--chart-1))" strokeWidth={2} fill="url(#lat)" dot={false} isAnimationActive={false} />
          {showP95 && <Area type="monotone" dataKey="p95Ms" stroke="hsl(var(--chart-3))" strokeWidth={1.5} fill="none" dot={false} isAnimationActive={false} />}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
