import { connection } from "next/server";
import type { Contact } from "@/db/schema";
import { dueFollowUps } from "@/lib/home-follow-ups";
import { newFromTeam, recentForOwner, starredItems, type HomeItem } from "@/lib/home";
import { actorResolver, type Actor } from "@/lib/object-history";

/** Everything Home shows, read in one go (awaits connection() to stay out of prerendering). */
export async function loadHome(businessId: string): Promise<{
  fresh: (HomeItem & { actor: Actor })[];
  recent: HomeItem[];
  starred: HomeItem[];
  followUps: Contact[];
  now: number;
}> {
  await connection();
  const actor = actorResolver(businessId);
  // Due by the end of today, so a morning look shows the whole day.
  const endOfDay = new Date();
  endOfDay.setHours(23, 59, 59, 999);
  return {
    fresh: newFromTeam(businessId, { limit: 20 }).map((i) => ({ ...i, actor: actor(i.by) })),
    recent: recentForOwner(businessId, 8),
    starred: starredItems(businessId, 12),
    followUps: dueFollowUps(businessId, endOfDay).slice(0, 10),
    now: Date.now(),
  };
}
