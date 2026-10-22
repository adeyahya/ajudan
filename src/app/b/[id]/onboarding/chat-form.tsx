"use client";

import { useFormStatus } from "react-dom";
import { Button } from "@/components/kit";
import { useT } from "@/components/i18n";

export function PendingButton({ children, variant = "primary" }: { children: React.ReactNode; variant?: "primary" | "secondary" }) {
  const { pending } = useFormStatus();
  const t = useT();
  return (
    <Button type="submit" variant={variant} disabled={pending}>
      {pending ? t("common.working") : children}
    </Button>
  );
}
