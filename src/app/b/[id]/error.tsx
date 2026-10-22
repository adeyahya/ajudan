"use client";

import Link from "next/link";
import { Button, Card } from "@/components/kit";
import { useT } from "@/components/i18n";

export default function BusinessError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useT();
  const noFolder = error.message.includes("No business folder is open");
  return (
    <Card className="mx-auto max-w-lg p-6">
      <h1 className="mb-1 text-lg text-foreground">{noFolder ? t("error.noFolderTitle") : t("error.title")}</h1>
      <p className="text-sm text-muted-foreground">{noFolder ? t("error.noFolderBody") : error.message}</p>
      <div className="mt-4 flex gap-2">
        <Link href="/" className="font-pixel text-primary underline">
          {t("notFound.back")}
        </Link>
        {!noFolder && (
          <Button variant="secondary" onClick={reset}>
            {t("common.retry")}
          </Button>
        )}
      </div>
    </Card>
  );
}
