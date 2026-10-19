"use client";

import { useTranslations } from "next-intl";
import { switchFacility } from "./actions";

/** Shown only for people who work in more than one facility. */
export function FacilitySwitcher({
  options,
  activeId,
}: {
  options: { id: string; name: string }[];
  activeId: string;
}) {
  const t = useTranslations("shell");
  if (options.length < 2) {
    const only = options[0];
    return only ? (
      <span className="text-muted-foreground hidden truncate text-sm sm:inline">{only.name}</span>
    ) : null;
  }
  return (
    <form action={switchFacility}>
      <label className="sr-only" htmlFor="facility-switcher">
        {t("facility")}
      </label>
      <select
        id="facility-switcher"
        name="facilityId"
        defaultValue={activeId}
        onChange={(event) => event.currentTarget.form?.requestSubmit()}
        className="border-border bg-background h-9 max-w-48 rounded-md border px-2 text-sm"
      >
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
      </select>
    </form>
  );
}
