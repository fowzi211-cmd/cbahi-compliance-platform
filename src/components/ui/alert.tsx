import type { ComponentProps } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const alertVariants = cva("rounded-md border p-3 text-sm", {
  variants: {
    tone: {
      info: "border-border bg-muted",
      success: "border-success/40 bg-success/10 text-success",
      danger: "border-danger/40 bg-danger/10 text-danger",
      warning: "border-warning/40 bg-warning/10 text-warning",
    },
  },
  defaultVariants: { tone: "info" },
});

// Errors are announced immediately; other tones politely.
export function Alert({
  className,
  tone,
  ...props
}: ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cn(alertVariants({ tone }), className)}
      {...props}
    />
  );
}
