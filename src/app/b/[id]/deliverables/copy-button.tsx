"use client";

import { useState } from "react";
import { Button } from "@/components/kit";
import { useT } from "@/components/i18n";

export function CopyButton({ text }: { text: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="secondary"
      className="h-7 px-2.5 text-xs"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // Clipboard can be blocked (e.g. insecure origin); nothing else to do.
        }
      }}
    >
      {copied ? t("common.copied") : t("common.copy")}
    </Button>
  );
}
