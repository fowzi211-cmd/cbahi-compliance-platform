import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

const fieldClasses =
  "border-border bg-background focus-visible:ring-ring aria-invalid:border-danger h-11 w-full rounded-md border px-3 text-base focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(fieldClasses, className)} {...props} />;
}

export function Select({ className, ...props }: ComponentProps<"select">) {
  return <select className={cn(fieldClasses, className)} {...props} />;
}

export function Label({ className, ...props }: ComponentProps<"label">) {
  return <label className={cn("text-sm font-medium", className)} {...props} />;
}

/** Label, control and hint stacked; the hint is linked with aria-describedby by the caller. */
export function Field({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("flex flex-col gap-1.5", className)} {...props} />;
}

export function FieldHint({ className, ...props }: ComponentProps<"p">) {
  return <p className={cn("text-muted-foreground text-sm", className)} {...props} />;
}
