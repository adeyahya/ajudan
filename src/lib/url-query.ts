/** `path` with a page's search params appended (for redirects that keep ?doc=, ?c= and the like). */
export function withQuery(path: string, searchParams: Record<string, string | string[] | undefined>) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(searchParams)) for (const x of ([] as (string | undefined)[]).concat(v)) if (x !== undefined) q.append(k, x);
  const s = q.toString();
  return s ? `${path}?${s}` : path;
}
