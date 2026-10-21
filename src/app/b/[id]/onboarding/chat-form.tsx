"use client";

import { useFormStatus } from "react-dom";
import { Button } from "@/components/kit";

export function PendingButton({ children, variant = "primary" }: { children: React.ReactNode; variant?: "primary" | "secondary" }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} disabled={pending}>
      {pending ? "Working…" : children}
    </Button>
  );
}
