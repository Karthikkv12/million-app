import { User, Palette, KeyRound, MonitorSmartphone, ScrollText, type LucideIcon } from "lucide-react";

export interface SettingsPageDef {
  id: string;
  label: string;
  group: "Account" | "Preferences" | "Security";
  desc: string;
  icon: LucideIcon;
}

export const SETTINGS_PAGES: SettingsPageDef[] = [
  { id: "profile",    label: "Profile",          group: "Account",     desc: "Your username, role and sign out.",               icon: User },
  { id: "appearance", label: "Appearance",       group: "Preferences", desc: "Light or dark, saved on this device.",            icon: Palette },
  { id: "security",   label: "Password",         group: "Security",    desc: "Change your password.",                           icon: KeyRound },
  { id: "devices",    label: "Devices",          group: "Security",    desc: "Where you're signed in, and signing devices out.", icon: MonitorSmartphone },
  { id: "activity",   label: "Sign-in activity", group: "Security",    desc: "Recent sign-ins and blocked attempts.",           icon: ScrollText },
];

export const SETTINGS_GROUPS = ["Account", "Preferences", "Security"] as const;
