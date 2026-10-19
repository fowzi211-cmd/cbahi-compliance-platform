import { redirect } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";

export default async function PlatformHome({ params }: PageProps<"/[locale]/platform">) {
  const { locale } = await params;
  redirect({ href: "/platform/standards", locale: locale as Locale });
}
