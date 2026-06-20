"use client";

import { create } from "zustand";
import { CheckCircle2, AlertCircle, Info } from "lucide-react";
import { cn } from "@/lib/utils";

type Kind = "success" | "error" | "info";
type Toast = { id: number; kind: Kind; message: string };

type ToastState = {
  toasts: Toast[];
  push: (kind: Kind, message: string) => void;
  dismiss: (id: number) => void;
};

let counter = 0;

export const useToast = create<ToastState>((set) => ({
  toasts: [],
  push: (kind, message) => {
    const id = ++counter;
    set((s) => ({ toasts: [...s.toasts, { id, kind, message }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 3800);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

export const toast = {
  success: (m: string) => useToast.getState().push("success", m),
  error: (m: string) => useToast.getState().push("error", m),
  info: (m: string) => useToast.getState().push("info", m),
};

const ICON = { success: CheckCircle2, error: AlertCircle, info: Info };
const STYLE: Record<Kind, string> = {
  success: "text-success",
  error: "text-danger",
  info: "text-brand",
};

export function Toaster() {
  const { toasts, dismiss } = useToast();
  return (
    <div className="fixed bottom-5 right-5 z-[60] flex w-80 flex-col gap-2">
      {toasts.map((t) => {
        const Icon = ICON[t.kind];
        return (
          <div
            key={t.id}
            onClick={() => dismiss(t.id)}
            className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-border bg-surface px-4 py-3 text-sm card-shadow animate-fade-up"
          >
            <Icon size={18} className={cn("mt-0.5 shrink-0", STYLE[t.kind])} />
            <span className="text-ink">{t.message}</span>
          </div>
        );
      })}
    </div>
  );
}
