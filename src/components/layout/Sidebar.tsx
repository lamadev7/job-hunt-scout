"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  FileText,
  History,
  Sparkles,
  PanelLeftClose,
  PanelLeft,
  Bot,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useUI } from "@/store/ui";

const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/details", label: "My Details", icon: FileText },
  { href: "/history", label: "Job hunts", icon: History },
  { href: "/enhancer", label: "AI Resume Enhancer", icon: Sparkles },
];

export function Sidebar() {
  const pathname = usePathname();
  const { sidebarCollapsed: collapsed, toggleSidebar } = useUI();

  return (
    <aside
      className={cn(
        "sticky top-0 flex h-dvh shrink-0 flex-col border-r border-border bg-surface transition-[width] duration-300",
        collapsed ? "w-[76px]" : "w-64"
      )}
    >
      <div className={cn("flex h-16 items-center gap-2.5 px-4", collapsed && "justify-center px-0")}>
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand text-white">
          <Bot size={20} />
        </div>
        {!collapsed && (
          <div className="leading-tight">
            <div className="text-sm font-semibold">JobPilot</div>
            <div className="text-[11px] text-ink-faint">Agentic job finder</div>
          </div>
        )}
      </div>

      <nav className="flex flex-1 flex-col gap-1 px-3 py-2">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              title={collapsed ? label : undefined}
              className={cn(
                "group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
                collapsed && "justify-center px-0",
                active
                  ? "bg-brand-soft text-brand-ink"
                  : "text-ink-soft hover:bg-surface-2 hover:text-ink"
              )}
            >
              <Icon size={19} className="shrink-0" />
              {!collapsed && <span className="truncate">{label}</span>}
            </Link>
          );
        })}
      </nav>

      <button
        onClick={toggleSidebar}
        className={cn(
          "m-3 flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-ink-soft transition-colors hover:bg-surface-2 hover:text-ink",
          collapsed && "justify-center px-0"
        )}
        title={collapsed ? "Expand" : "Collapse"}
      >
        {collapsed ? <PanelLeft size={19} /> : <PanelLeftClose size={19} />}
        {!collapsed && <span>Collapse</span>}
      </button>
    </aside>
  );
}
