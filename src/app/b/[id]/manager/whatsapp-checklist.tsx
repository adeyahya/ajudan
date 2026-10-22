import Link from "next/link";
import { connection } from "next/server";
import type { ReactNode } from "react";
import { Badge, Card } from "@/components/kit";
import { listHumans } from "@/lib/humans";
import { linkState } from "@/lib/whatsapp";
import { setMyNumber } from "./actions";
import { OwnerNumberForm } from "./owner-form";

/**
 * Shown on the manager page until the owner is a person on the team (ownerHumanId):
 * the three steps to get approvals and team updates on WhatsApp, each with its real
 * state. Step 2 can be done right here.
 */
export async function WhatsappChecklist({ businessId, allowedChats }: { businessId: string; allowedChats: number }) {
  await connection();
  const link = await linkState();
  const linked = link.state === "linked";
  const humans = listHumans(businessId);
  const profile = `/b/${businessId}/profile`;
  const team = `/b/${businessId}/team`;

  return (
    <Card className="mb-4 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-pixel text-sm">Get the team on your WhatsApp</h2>
        <span className="text-xs text-muted-foreground">Approvals and updates reach you even when the app is closed.</span>
      </div>
      <ol className="grid gap-3">
        <Step n={1} done={linked} title="Link the business's WhatsApp">
          <p>
            Scan the QR on the{" "}
            <Link href={profile} className="underline">
              Business page
            </Link>
            . Use a number that is <b>not</b> your personal one (the business number, or a spare SIM): this account is the one
            that <i>sends</i> messages to you and your team, and WhatsApp can&apos;t message itself.
          </p>
          {link.state === "qr" || link.state === "starting" ? <p className="text-amber-600 dark:text-amber-400">Linking in progress on the Business page…</p> : null}
        </Step>
        <Step n={2} done={false} title="Add your own number and mark it as you">
          <p>
            Your personal WhatsApp joins the team as a person. The business account above then sends you approval requests
            (answer &ldquo;ya &lt;code&gt;&rdquo; or &ldquo;tidak &lt;code&gt;&rdquo;) and the manager&apos;s updates.
          </p>
          {humans.length > 0 && (
            <p>
              Already on the team: {humans.map((h) => h.name).join(", ")}. If one of them is you, press &ldquo;This is me&rdquo; on the{" "}
              <Link href={team} className="underline">
                Team page
              </Link>
              . Otherwise:
            </p>
          )}
          <OwnerNumberForm action={setMyNumber.bind(null, businessId)} />
        </Step>
        <Step n={3} done={allowedChats > 0} title="Choose the chats the team may use (optional)">
          <p>
            Tick the groups teammates may read and post in on the{" "}
            <Link href={profile} className="underline">
              Business page
            </Link>
            ; everything else stays private. Approvals go to your number directly, so this is only for teamwork in groups.
          </p>
        </Step>
      </ol>
    </Card>
  );
}

function Step({ n, done, title, children }: { n: number; done: boolean; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span
        className={`mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-medium ${
          done ? "bg-emerald-500 text-white" : "bg-muted text-muted-foreground"
        }`}
        aria-hidden
      >
        {done ? "✓" : n}
      </span>
      <div className="min-w-0 flex-1 space-y-2 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{title}</span>
          <Badge tone={done ? "green" : "neutral"}>{done ? "Done" : "To do"}</Badge>
        </div>
        <div className="space-y-2 text-muted-foreground [&_b]:text-foreground">{children}</div>
      </div>
    </li>
  );
}
