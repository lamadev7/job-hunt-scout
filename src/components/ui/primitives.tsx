import * as React from "react";
import { cn } from "@/lib/utils";

/* ---------------- Card ---------------- */
export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "card-shadow rounded-[var(--radius-card)] border border-border bg-surface",
        className
      )}
      {...props}
    />
  );
}

/* ---------------- Button ---------------- */
type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost" | "outline" | "subtle" | "danger";
  size?: "sm" | "md" | "lg" | "icon";
};

const BTN_VARIANT: Record<NonNullable<ButtonProps["variant"]>, string> = {
  primary: "bg-brand text-white hover:bg-brand/90 shadow-sm",
  ghost: "text-ink-soft hover:bg-surface-2 hover:text-ink",
  outline: "border border-border bg-surface text-ink hover:bg-surface-2",
  subtle: "bg-brand-soft text-brand-ink hover:bg-brand-soft/70",
  danger: "bg-danger text-white hover:bg-danger/90",
};
const BTN_SIZE: Record<NonNullable<ButtonProps["size"]>, string> = {
  sm: "h-8 px-3 text-xs gap-1.5",
  md: "h-10 px-4 text-sm gap-2",
  lg: "h-12 px-6 text-base gap-2",
  icon: "h-9 w-9",
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        "inline-flex select-none items-center justify-center rounded-xl font-medium transition-colors disabled:pointer-events-none disabled:opacity-50",
        BTN_VARIANT[variant],
        BTN_SIZE[size],
        className
      )}
      {...props}
    />
  )
);
Button.displayName = "Button";

/* ---------------- Badge / Chip ---------------- */
type Tone = "brand" | "success" | "warn" | "danger" | "neutral";
const TONE: Record<Tone, string> = {
  brand: "bg-brand-soft text-brand-ink",
  success: "bg-success-soft text-success",
  warn: "bg-warn-soft text-warn",
  danger: "bg-danger-soft text-danger",
  neutral: "bg-surface-2 text-ink-soft",
};

export function Badge({
  tone = "neutral",
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium",
        TONE[tone],
        className
      )}
      {...props}
    />
  );
}

export function Chip({
  active,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      className={cn(
        "rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors",
        active
          ? "border-brand bg-brand text-white"
          : "border-border bg-surface text-ink-soft hover:bg-surface-2",
        className
      )}
      {...props}
    />
  );
}

/* ---------------- Progress ---------------- */
function toneForPct(v: number): string {
  if (v >= 75) return "var(--color-success)";
  if (v >= 50) return "var(--color-brand)";
  if (v >= 30) return "var(--color-warn)";
  return "var(--color-danger)";
}

export function ProgressBar({ value, className }: { value: number; className?: string }) {
  return (
    <div className={cn("h-2 w-full overflow-hidden rounded-full bg-surface-2", className)}>
      <div
        className="h-full rounded-full transition-[width] duration-500"
        style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: toneForPct(value) }}
      />
    </div>
  );
}

export function ProgressRing({
  value,
  size = 64,
  stroke = 7,
  label,
}: {
  value: number;
  size?: number;
  stroke?: number;
  label?: React.ReactNode;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(100, value));
  const offset = c - (v / 100) * c;
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-surface-2)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={toneForPct(v)}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          className="transition-[stroke-dashoffset] duration-700"
        />
      </svg>
      <span className="absolute text-sm font-semibold">{label ?? `${Math.round(v)}%`}</span>
    </div>
  );
}

/* ---------------- Spinner / Skeleton ---------------- */
export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent",
        className
      )}
    />
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton rounded-lg", className)} />;
}

/* ---------------- Section header ---------------- */
export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-ink-soft">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
