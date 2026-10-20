import {
  ClipboardCheck,
  FileText,
  LayoutDashboard,
  LifeBuoy,
  Library,
  ListChecks,
  Route,
  Settings,
  UserCog,
  Users,
  type LucideIcon,
} from "lucide-react";

export type NavKey =
  | "dashboard"
  | "standards"
  | "assessments"
  | "tracers"
  | "findings"
  | "documents"
  | "committees"
  | "requests"
  | "people"
  | "settings";

export type NavItem = {
  key: NavKey;
  href: string;
  icon: LucideIcon;
};

export const navItems: NavItem[] = [
  { key: "dashboard", href: "/", icon: LayoutDashboard },
  { key: "standards", href: "/standards", icon: Library },
  { key: "assessments", href: "/assessments", icon: ClipboardCheck },
  { key: "tracers", href: "/tracers", icon: Route },
  { key: "findings", href: "/findings", icon: ListChecks },
  { key: "documents", href: "/documents", icon: FileText },
  { key: "committees", href: "/committees", icon: Users },
  { key: "requests", href: "/requests", icon: LifeBuoy },
  { key: "people", href: "/people", icon: UserCog },
  { key: "settings", href: "/settings", icon: Settings },
];
