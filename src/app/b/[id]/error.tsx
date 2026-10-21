"use client";

import Link from "next/link";
import { Button, Card } from "@/components/kit";

export default function BusinessError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const noFolder = error.message.includes("No business folder is open");
  return (
    <Card className="mx-auto max-w-lg p-6">
      <h1 className="mb-1 text-lg text-primary">{noFolder ? "No business is open" : "Something went wrong"}</h1>
      <p className="text-sm text-muted-foreground">
        {noFolder ? "Pick or create a business folder first." : error.message}
      </p>
      <div className="mt-4 flex gap-2">
        <Link href="/" className="font-pixel text-primary underline">
          ← Your businesses
        </Link>
        {!noFolder && (
          <Button variant="secondary" onClick={reset}>
            Try again
          </Button>
        )}
      </div>
    </Card>
  );
}
