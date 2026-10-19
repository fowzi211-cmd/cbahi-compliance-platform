import {
  ClipboardCheck,
  FileText,
  LayoutDashboard,
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
  | "people"
  | "settings";

export type NavItem = {
  key: NavKey;
  href: string;
  icon: LucideIcon;
  // Roadmap milestone that delivers the module; undefined once it is live.
  milestone?: string;
};

export const navItems: NavItem[] = [
  { key: "dashboard", href: "/", icon: LayoutDashboard },
  { key: "standards", href: "/standards", icon: Library, milestone: "M4" },
  { key: "assessments", href: "/assessments", icon: ClipboardCheck, milestone: "M7" },
  { key: "tracers", href: "/tracers", icon: Route, milestone: "M11" },
  { key: "findings", href: "/findings", icon: ListChecks, milestone: "M9" },
  { key: "documents", href: "/documents", icon: FileText, milestone: "M8" },
  { key: "committees", href: "/committees", icon: Users, milestone: "M12" },
  { key: "people", href: "/people", icon: UserCog },
  { key: "settings", href: "/settings", icon: Settings, milestone: "M5" },
];

export const sectionMilestones = Object.fromEntries(
  navItems.filter((item) => item.milestone).map((item) => [item.href.slice(1), item]),
) as Record<string, NavItem>;
