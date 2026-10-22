"use client";

import { useFormStatus } from "react-dom";
import { Button } from "@/components/kit";

/** A form's submit button that shows a spinner while the Server Function runs. */
export function PendingButton({ children, variant = "primary" }: { children: React.ReactNode; variant?: "primary" | "secondary" }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" variant={variant} loading={pending} disabled={pending}>
      {children}
    </Button>
  );
}
