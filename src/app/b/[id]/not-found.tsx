import Link from "next/link";
import { Card } from "@/components/kit";

/** Shown for a business that isn't in the open folder (or doesn't exist). */
export default function BusinessNotFound() {
  return (
    <Card className="mx-auto max-w-lg p-6">
      <h1 className="mb-1 text-lg text-primary">This business isn&apos;t open</h1>
      <p className="text-sm text-muted-foreground">
        Each business lives in its own folder, and only one is open at a time. Go to your businesses and switch to it.
      </p>
      <Link href="/" className="font-pixel mt-4 inline-block text-primary underline">
        ← Your businesses
      </Link>
    </Card>
  );
}
