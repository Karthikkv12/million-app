"use client";
import type { JSX } from "react";
import Link from "next/link";
import { notFound, useParams } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { SETTINGS_PAGES } from "../registry";
import { ProfileSection, AppearanceSection, PasswordSection, DevicesSection, ActivitySection } from "../sections";
import { UsersSection } from "@/components/settings/UsersSection";

const COMPONENTS: Record<string, () => JSX.Element> = {
  profile: ProfileSection,
  appearance: AppearanceSection,
  security: PasswordSection,
  devices: DevicesSection,
  activity: ActivitySection,
  users: UsersSection,
};

export default function SettingsSectionPage() {
  const { section } = useParams<{ section: string }>();
  const def = SETTINGS_PAGES.find((p) => p.id === section);
  const Body = COMPONENTS[section];
  if (!def || !Body) notFound();
  return (
    <>
      <Link href="/settings" className="mb-5 inline-flex items-center gap-1 text-sm text-foreground/60 transition hover:text-foreground lg:hidden">
        <ChevronLeft size={16} /> Settings
      </Link>
      <div className="mb-6">
        <p className="eyebrow mb-2 flex items-center gap-2"><span className="h-px w-4 bg-foreground/30" />{def.group}</p>
        <h1 className="text-3xl font-semibold tracking-[-0.035em] text-foreground">{def.label}</h1>
        <p className="mt-1.5 text-[15px] text-foreground/60">{def.desc}</p>
      </div>
      <Body />
    </>
  );
}
