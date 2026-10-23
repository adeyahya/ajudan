/**
 * Running inside the Ajudan desktop app (electron/main.cjs)? There, every open
 * business has its own web server and worker pinned to its folder and keeps working
 * in the background; the one window switches between them (window.ajudan.openFolder)
 * instead of this server switching folders.
 */
export const IN_APP = process.env.AJUDAN_APP === "1";

/** The folder this server is pinned to (a business window), if any. */
export const pinnedFolder = () => (IN_APP ? (process.env.AJUDAN_DATA_DIR ?? null) : null);

export function routeFor(businessId: string, status: string | null) {
  if (status === "onboarding") return `/b/${businessId}/onboarding`;
  if (status === "active") return `/b/${businessId}`;
  return `/b/${businessId}/team`;
}
