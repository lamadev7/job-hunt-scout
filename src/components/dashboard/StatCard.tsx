import { Card } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

export function StatCard({
  label,
  value,
  hint,
  icon,
  tone = "brand",
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  icon?: React.ReactNode;
  tone?: "brand" | "success" | "warn";
}) {
  const toneBg = {
    brand: "bg-brand-soft text-brand-ink",
    success: "bg-success-soft text-success",
    warn: "bg-warn-soft text-warn",
  }[tone];
  return (
    <Card className="p-5 animate-fade-up">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-sm text-ink-soft">{label}</div>
          <div className="mt-2 text-3xl font-semibold tracking-tight">{value}</div>
        </div>
        {icon && <div className={cn("flex h-10 w-10 items-center justify-center rounded-xl", toneBg)}>{icon}</div>}
      </div>
      {hint && <div className="mt-3 text-xs text-ink-faint">{hint}</div>}
    </Card>
  );
}
