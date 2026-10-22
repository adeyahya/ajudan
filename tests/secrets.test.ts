import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Only the pure helpers are exercised: nothing here touches the Keychain or the DB.
process.env.AJUDAN_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ajudan-secrets-"));
const { PLACEHOLDER, SECRET_NAME, hostAllowed, normalizeHost, redact } = await import("@/lib/secrets");

describe("normalizeHost", () => {
  it("extracts the hostname from hosts, URLs and paths", () => {
    expect(normalizeHost("orucraft.com")).toBe("orucraft.com");
    expect(normalizeHost("orucraft.com/api")).toBe("orucraft.com");
    expect(normalizeHost("https://api.x.com/v1?y=1")).toBe("api.x.com");
    expect(normalizeHost("http://API.X.COM:8080")).toBe("api.x.com");
  });

  it("trims, lowercases and strips a leading wildcard", () => {
    expect(normalizeHost("  Orucraft.COM ")).toBe("orucraft.com");
    expect(normalizeHost("*.orucraft.com")).toBe("orucraft.com");
  });

  it("returns null for empty or unparseable input", () => {
    expect(normalizeHost("")).toBeNull();
    expect(normalizeHost("   ")).toBeNull();
    expect(normalizeHost("http://")).toBeNull();
    expect(normalizeHost("not a host")).toBeNull();
  });
});

describe("hostAllowed", () => {
  const hosts = ["orucraft.com", "api.x.com"];

  it("matches the host and its subdomains", () => {
    expect(hostAllowed("orucraft.com", hosts)).toBe(true);
    expect(hostAllowed("shop.orucraft.com", hosts)).toBe(true);
    expect(hostAllowed("a.b.orucraft.com", hosts)).toBe(true);
    expect(hostAllowed("api.x.com", hosts)).toBe(true);
  });

  it("refuses other hosts, prefix tricks and parents", () => {
    expect(hostAllowed("evil.com", hosts)).toBe(false);
    expect(hostAllowed("evilorucraft.com", hosts)).toBe(false);
    expect(hostAllowed("orucraft.com.evil.com", hosts)).toBe(false);
    expect(hostAllowed("x.com", hosts)).toBe(false);
    expect(hostAllowed("orucraft.com", [])).toBe(false);
  });

  it("lowercases the host but relies on the list being normalized already", () => {
    expect(hostAllowed("SHOP.Orucraft.COM", hosts)).toBe(true);
    // setSecret() runs normalizeHost over the list; raw uppercase entries would not match.
    expect(hostAllowed("orucraft.com", ["Orucraft.com"])).toBe(false);
  });
});

describe("redact", () => {
  it("replaces every occurrence of each value with its name", () => {
    const values = new Map([["ORUCRAFT_API", "sk-abc123"]]);
    expect(redact("token sk-abc123 and again sk-abc123", values)).toBe("token [secret ORUCRAFT_API] and again [secret ORUCRAFT_API]");
  });

  it("handles several secrets and leaves other text alone", () => {
    const values = new Map([
      ["A", "alpha-1"],
      ["B", "bravo-2"],
    ]);
    expect(redact("alpha-1 / bravo-2 / charlie", values)).toBe("[secret A] / [secret B] / charlie");
    expect(redact("nothing here", values)).toBe("nothing here");
    expect(redact("", values)).toBe("");
  });

  it("treats the value literally (no regex)", () => {
    const values = new Map([["RE", "a.b*c"]]);
    expect(redact("axbbc a.b*c", values)).toBe("axbbc [secret RE]");
  });

  it("skips values shorter than 4 characters", () => {
    const values = new Map([["PIN", "123"]]);
    expect(redact("code 123", values)).toBe("code 123");
    expect(redact("code 1234", new Map([["PIN", "1234"]]))).toBe("code [secret PIN]");
  });

  it("applies values in Map order, so a shorter prefix value can split a longer one (current behaviour)", () => {
    const values = new Map([
      ["SHORT", "abcd"],
      ["LONG", "abcdefgh"],
    ]);
    expect(redact("abcdefgh", values)).toBe("[secret SHORT]efgh");
  });
});

describe("SECRET_NAME and PLACEHOLDER", () => {
  it("accepts SCREAMING_SNAKE names of 2–48 chars", () => {
    expect(SECRET_NAME.test("ORUCRAFT_API")).toBe(true);
    expect(SECRET_NAME.test("A1")).toBe(true);
    expect(SECRET_NAME.test("A")).toBe(false);
    expect(SECRET_NAME.test("lower")).toBe(false);
    expect(SECRET_NAME.test("1ABC")).toBe(false);
    expect(SECRET_NAME.test("A".repeat(49))).toBe(false);
  });

  it("finds {{secret.NAME}} placeholders", () => {
    const text = "Bearer {{secret.TOKEN}} and {{ secret.OTHER_1 }} but not {{secret.bad}}";
    const names = [...text.matchAll(PLACEHOLDER)].map((m) => m[1]);
    expect(names).toEqual(["TOKEN", "OTHER_1"]);
  });
});
