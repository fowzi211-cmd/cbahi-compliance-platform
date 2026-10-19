import { ShieldAlert } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Suspense } from "react";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Pending } from "@/components/ui/pending";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { requireAppContext } from "@/lib/session";
import { listLibrary, localized } from "@/modules/standards/service";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/standards">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale: locale as Locale, namespace: "nav" });
  return { title: t("standards") };
}

export default async function StandardsPage({ params }: PageProps<"/[locale]/standards">) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);
  const t = await getTranslations();

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold sm:text-3xl">{t("nav.standards")}</h1>
        <p className="text-muted-foreground max-w-prose">{t("standards.library.intro")}</p>
      </div>
      <Suspense fallback={<Pending />}>
        <LibraryList locale={locale as Locale} />
      </Suspense>
    </div>
  );
}

async function LibraryList({ locale }: { locale: Locale }) {
  const t = await getTranslations({ locale, namespace: "standards" });
  const ctx = await requireAppContext(locale);
  const frameworks = await listLibrary(ctx.access);

  if (frameworks.length === 0) {
    return (
      <Card>
        <CardDescription>{t("library.empty")}</CardDescription>
      </Card>
    );
  }

  return (
    <ul className="grid gap-4 sm:grid-cols-2">
      {frameworks.map((f) => (
        <li key={f.id}>
          <Link href={`/standards/${f.id}`} className="block h-full">
            <Card className="hover:border-primary flex h-full flex-col gap-3 transition-colors">
              <CardTitle>{localized(locale, f.nameAr, f.nameEn).text}</CardTitle>
              <CardDescription>
                <bdi dir="ltr">{f.code}</bdi> · {t("library.edition", { edition: f.edition })} ·{" "}
                {t(`programs.${f.program as "ambulatory"}`)}
              </CardDescription>
              <dl className="mt-auto grid grid-cols-3 gap-2 text-center">
                <div>
                  <dt className="text-muted-foreground text-xs">{t("library.chapters")}</dt>
                  <dd className="text-lg font-semibold">{f._count.chapters}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground text-xs">{t("library.elements")}</dt>
                  <dd className="text-lg font-semibold">{f._count.elements}</dd>
                </div>
                <div>
                  <dt className="text-danger flex items-center justify-center gap-1 text-xs">
                    <ShieldAlert className="size-3.5" aria-hidden />
                    {t("library.esr")}
                  </dt>
                  <dd className="text-danger text-lg font-semibold">{f.esrCount}</dd>
                </div>
              </dl>
            </Card>
          </Link>
        </li>
      ))}
    </ul>
  );
}
