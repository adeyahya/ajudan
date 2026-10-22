/**
 * Running inside the Ajudan desktop app (electron/main.cjs)? There, every business
 * has its own window, web server and worker pinned to its folder, and the
 * Businesses window opens folders in new windows instead of switching.
 */
export const IN_APP = process.env.AJUDAN_APP === "1";

/** The folder this server is pinned to (a business window), if any. */
export const pinnedFolder = () => (IN_APP ? (process.env.AJUDAN_DATA_DIR ?? null) : null);

export function routeFor(businessId: string, status: string | null) {
  if (status === "onboarding") return `/b/${businessId}/onboarding`;
  if (status === "active") return `/b/${businessId}/manager`;
  return `/b/${businessId}/team`;
}
