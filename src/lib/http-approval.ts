import { PLACEHOLDER } from "@/lib/secrets";

/** What an http_request approval shows the owner (worker/tools.ts has the tool). */
export type HttpRequestView = {
  method: string;
  /** The URL as the teammate wrote it, placeholders included (never a secret value). */
  url: string;
  host: string;
  headers: [string, string][];
  /** The body, pretty-printed when it's JSON, cut to `max` characters. */
  bodyPreview: string;
  bodyTruncated: boolean;
  /** Secret names the request fills in ({{secret.NAME}}), in order of first use. */
  secrets: string[];
  saveAs: string | null;
};

const str = (v: unknown) => (v == null ? "" : String(v));

export function describeHttpRequest(input: Record<string, unknown>, max = 600): HttpRequestView {
  const method = (str(input.method) || "GET").toUpperCase();
  const url = str(input.url);
  let host = "";
  try {
    host = new URL(url.replace(PLACEHOLDER, "x")).hostname;
  } catch {
    // keep the raw text
  }
  const headers: [string, string][] =
    input.headers && typeof input.headers === "object" && !Array.isArray(input.headers)
      ? Object.entries(input.headers as Record<string, unknown>).map(([k, v]) => [k, str(v)])
      : [];
  const body = str(input.body);
  let pretty = body;
  if (body.trim()) {
    try {
      pretty = JSON.stringify(JSON.parse(body), null, 2);
    } catch {
      // not JSON
    }
  }
  const secrets: string[] = [];
  for (const text of [url, ...headers.map(([, v]) => v), body]) {
    for (const m of text.matchAll(PLACEHOLDER)) if (!secrets.includes(m[1])) secrets.push(m[1]);
  }
  return {
    method,
    url,
    host,
    headers,
    bodyPreview: pretty.length > max ? pretty.slice(0, max) : pretty,
    bodyTruncated: pretty.length > max,
    secrets,
    saveAs: str(input.save_as) || null,
  };
}
