import { User, Users, Palette, KeyRound, MonitorSmartphone, ScrollText, Bell, type LucideIcon } from "lucide-react";

export interface SettingsPageDef {
  id: string;
  label: string;
  group: "Account" | "Preferences" | "Security" | "Admin";
  desc: string;
  icon: LucideIcon;
  /** Shown to admins only. */
  adminOnly?: boolean;
}

export const SETTINGS_PAGES: SettingsPageDef[] = [
  { id: "profile",    label: "Profile",          group: "Account",     desc: "Your username, role and sign out.",               icon: User },
  { id: "appearance", label: "Appearance",       group: "Preferences", desc: "Light or dark, saved on this device.",            icon: Palette },
  { id: "notifications", label: "Notifications", group: "Preferences", desc: "Buy-back and trade alerts on this phone.",        icon: Bell },
  { id: "security",   label: "Password",         group: "Security",    desc: "Change your password.",                           icon: KeyRound },
  { id: "devices",    label: "Devices",          group: "Security",    desc: "Where you're signed in, and signing devices out.", icon: MonitorSmartphone },
  { id: "activity",   label: "Sign-in activity", group: "Security",    desc: "Recent sign-ins and blocked attempts.",           icon: ScrollText },
  { id: "users",      label: "Users",            group: "Admin",       desc: "Who can sign in to OptionFlow, and what they can do.", icon: Users, adminOnly: true },
];

export const SETTINGS_GROUPS = ["Account", "Preferences", "Security", "Admin"] as const;

/** Pages this viewer may see. */
export const visiblePages = (isAdmin: boolean) => SETTINGS_PAGES.filter((p) => !p.adminOnly || isAdmin);
