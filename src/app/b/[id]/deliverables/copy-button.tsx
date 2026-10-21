"use client";

import { useState } from "react";
import { Button } from "@/components/kit";

export function CopyButton({ text }: { text: string }) {
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
      {copied ? "Copied" : "Copy"}
    </Button>
  );
}
