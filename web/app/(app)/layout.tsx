"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import Navbar from "@/components/Navbar";
import BottomNav from "@/components/BottomNav";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 rounded-full border-2 border-blue-500 border-t-transparent animate-spin" />
          <p className="text-sm text-gray-400">Loading…</p>
        </div>
      </div>
    );
  }
  if (!user) return null;

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      {/* pb-nav adds padding equal to bottom nav height + safe-area on mobile */}
      <main className="flex-1 pb-nav lg:pb-0">{children}</main>
      <BottomNav />
    </div>
  );
}
