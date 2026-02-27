"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { SidebarProvider, useSidebar } from "@/lib/sidebar";
import Navbar from "@/components/Navbar";
import BottomNav from "@/components/BottomNav";

function AppShell({ children }: { children: React.ReactNode }) {
  const { collapsed } = useSidebar();
  return (
    <div className="min-h-screen w-full">
      <Navbar />
      <main
        className={[
          "min-w-0 pb-nav lg:pb-0 animate-fade-up transition-[padding-left] duration-200 ease-in-out",
          collapsed ? "lg:pl-[64px]" : "lg:pl-[240px]",
        ].join(" ")}
      >
        {children}
      </main>
      <BottomNav />
    </div>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) router.replace("/");
  }, [loading, user, router]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 rounded-full border-2 border-[var(--foreground)]/30 border-t-[var(--foreground)] animate-spin" />
          <p className="text-sm text-foreground/70">Loading…</p>
        </div>
      </div>
    );
  }
  if (!user) return null;

  return (
    <SidebarProvider>
      <AppShell>{children}</AppShell>
    </SidebarProvider>
  );
}

