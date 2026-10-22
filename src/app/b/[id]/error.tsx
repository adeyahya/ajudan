"use client";

import { AlertTriangle, FolderOpen } from "lucide-react";
import Link from "next/link";
import { Button, EmptyState, PageBody } from "@/components/kit";
import { useT } from "@/components/i18n";

export default function BusinessError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useT();
  const noFolder = error.message.includes("No business folder is open");
  return (
    <PageBody>
      <EmptyState
        icon={noFolder ? <FolderOpen /> : <AlertTriangle />}
        title={noFolder ? t("error.noFolderTitle") : t("error.title")}
        body={noFolder ? t("error.noFolderBody") : error.message}
        action={
          <>
            {!noFolder && (
              <Button size="sm" onClick={reset}>
                {t("common.retry")}
              </Button>
            )}
            <Button size="sm" variant="secondary" asChild>
              <Link href="/">{t("notFound.back")}</Link>
            </Button>
          </>
        }
      />
    </PageBody>
  );
}
