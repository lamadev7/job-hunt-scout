"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const PALETTE = ["#4f46e5", "#7c3aed", "#0ea5e9", "#16a34a", "#d97706", "#db2777"];

const tooltipStyle = {
  borderRadius: 12,
  border: "1px solid var(--color-border)",
  fontSize: 12,
  boxShadow: "0 8px 24px rgba(16,18,34,.08)",
};

export function TimelineChart({
  data,
}: {
  data: { date: string; applied: number; matched: number }[];
}) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <AreaChart data={data} margin={{ left: -20, right: 8, top: 8 }}>
        <defs>
          <linearGradient id="gApplied" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#4f46e5" stopOpacity={0.35} />
            <stop offset="100%" stopColor="#4f46e5" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="gMatched" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0ea5e9" stopOpacity={0.3} />
            <stop offset="100%" stopColor="#0ea5e9" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
        <XAxis dataKey="date" tick={{ fontSize: 11, fill: "var(--color-ink-faint)" }} tickLine={false} axisLine={false} />
        <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "var(--color-ink-faint)" }} tickLine={false} axisLine={false} />
        <Tooltip contentStyle={tooltipStyle} />
        <Area type="monotone" dataKey="matched" stroke="#0ea5e9" fill="url(#gMatched)" strokeWidth={2} name="Matched" />
        <Area type="monotone" dataKey="applied" stroke="#4f46e5" fill="url(#gApplied)" strokeWidth={2} name="Applied" />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function PortalBarChart({ data }: { data: { portal: string; count: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} margin={{ left: -20, right: 8, top: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
        <XAxis dataKey="portal" tick={{ fontSize: 11, fill: "var(--color-ink-faint)" }} tickLine={false} axisLine={false} />
        <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "var(--color-ink-faint)" }} tickLine={false} axisLine={false} />
        <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--color-surface-2)" }} />
        <Bar dataKey="count" radius={[6, 6, 0, 0]} name="Applications">
          {data.map((_, i) => (
            <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
