"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import Navbar from "@/components/Navbar";
import BottomNav from "@/components/BottomNav";
import AiChat from "@/components/AiChat";

function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen w-full overflow-x-hidden dot-grid">
      <Navbar />
      <main className="mx-auto w-full max-w-[1680px] min-w-0 overflow-x-hidden pb-nav md:pb-10 animate-fade-up">
        {children}
      </main>
      <BottomNav />
      {/* AI Chat — hidden for now, do not delete */}
      <div className="hidden"><AiChat /></div>
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
    <AppShell>{children}</AppShell>
  );
}

