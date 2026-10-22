import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

process.env.AJUDAN_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ajudan-http-approval-"));
const { describeHttpRequest } = await import("@/lib/http-approval");

describe("describeHttpRequest", () => {
  it("reads the method, host and the secret names used, without touching the placeholders", () => {
    const r = describeHttpRequest({
      url: "https://orucraft.com/api/agent/v1/orders?key={{secret.ORUCRAFT_API}}",
      method: "post",
      headers: { Authorization: "Bearer {{secret.ORUCRAFT_API}}", "X-Shop": "{{ secret.SHOP_TOKEN }}" },
      body: '{"status":"shipped","note":"{{secret.NOTE_KEY}}"}',
      save_as: "orders.json",
    });
    expect(r.method).toBe("POST");
    expect(r.host).toBe("orucraft.com");
    expect(r.url).toContain("{{secret.ORUCRAFT_API}}");
    expect(r.secrets).toEqual(["ORUCRAFT_API", "SHOP_TOKEN", "NOTE_KEY"]);
    expect(r.headers).toEqual([
      ["Authorization", "Bearer {{secret.ORUCRAFT_API}}"],
      ["X-Shop", "{{ secret.SHOP_TOKEN }}"],
    ]);
    expect(r.saveAs).toBe("orders.json");
  });

  it("pretty-prints a JSON body and truncates long ones", () => {
    const short = describeHttpRequest({ url: "https://a.com", body: '{"a":1}' });
    expect(short.bodyPreview).toBe('{\n  "a": 1\n}');
    expect(short.bodyTruncated).toBe(false);
    const long = describeHttpRequest({ url: "https://a.com", body: "x".repeat(1000) }, 100);
    expect(long.bodyPreview).toHaveLength(100);
    expect(long.bodyTruncated).toBe(true);
  });

  it("defaults to GET and survives an invalid URL or odd headers", () => {
    const r = describeHttpRequest({ url: "not a url", headers: "nope" });
    expect(r.method).toBe("GET");
    expect(r.host).toBe("");
    expect(r.headers).toEqual([]);
    expect(r.secrets).toEqual([]);
    expect(r.bodyPreview).toBe("");
  });

  it("can be called twice in a row (the shared regex keeps no state)", () => {
    const input = { url: "https://a.com/{{secret.ONE}}" };
    expect(describeHttpRequest(input).secrets).toEqual(["ONE"]);
    expect(describeHttpRequest(input).secrets).toEqual(["ONE"]);
  });
});
