"use client";

import Link from "next/link";
import { Card } from "@/components/kit";
import { useT } from "@/components/i18n";

/** Shown for a business that isn't in the open folder (or doesn't exist). */
export default function BusinessNotFound() {
  const t = useT();
  return (
    <Card className="mx-auto max-w-lg p-6">
      <h1 className="mb-1 text-lg text-primary">{t("notFound.title")}</h1>
      <p className="text-sm text-muted-foreground">{t("notFound.body")}</p>
      <Link href="/" className="font-pixel mt-4 inline-block text-primary underline">
        {t("notFound.back")}
      </Link>
    </Card>
  );
}
