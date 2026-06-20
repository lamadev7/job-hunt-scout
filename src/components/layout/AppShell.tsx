import { Sidebar } from "./Sidebar";
import { Toaster } from "@/components/ui/toast";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh">
      <Sidebar />
      <main className="min-w-0 flex-1">
        <div className="mx-auto w-full max-w-7xl px-6 py-8 lg:px-10">{children}</div>
      </main>
      <Toaster />
    </div>
  );
}
