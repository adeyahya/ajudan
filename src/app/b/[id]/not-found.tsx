"use client";

import { FolderSearch } from "lucide-react";
import Link from "next/link";
import { Button, EmptyState, PageBody } from "@/components/kit";
import { useT } from "@/components/i18n";

/** Shown for a business that isn't in the open folder (or doesn't exist). */
export default function BusinessNotFound() {
  const t = useT();
  return (
    <PageBody>
      <EmptyState
        icon={<FolderSearch />}
        title={t("notFound.title")}
        body={t("notFound.body")}
        action={
          <Button size="sm" variant="secondary" asChild>
            <Link href="/">{t("notFound.back")}</Link>
          </Button>
        }
      />
    </PageBody>
  );
}
