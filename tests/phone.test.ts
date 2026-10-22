import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

process.env.AJUDAN_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ajudan-phone-"));
const { humanJid, normalizePhone } = await import("@/lib/humans");

describe("normalizePhone", () => {
  it("keeps international numbers, stripping + and formatting", () => {
    expect(normalizePhone("+6281234567890")).toBe("6281234567890");
    expect(normalizePhone("+62 812-3456-7890")).toBe("6281234567890");
    expect(normalizePhone("(+62) 812 3456 7890")).toBe("6281234567890");
    expect(normalizePhone("6281234567890")).toBe("6281234567890");
  });

  it("treats a 00 prefix as the international prefix", () => {
    expect(normalizePhone("006281234567890")).toBe("6281234567890");
  });

  it("replaces a leading 0 with the country code for the business language", () => {
    expect(normalizePhone("0812-3456-7890", "id")).toBe("6281234567890");
    expect(normalizePhone("0123456789", "ms")).toBe("60123456789");
  });

  it("refuses a leading 0 when the language has no country code", () => {
    expect(normalizePhone("081234567890")).toBeNull();
    expect(normalizePhone("081234567890", "en")).toBeNull();
    expect(normalizePhone("081234567890", "fr")).toBeNull();
  });

  it("refuses numbers that are too short or too long", () => {
    expect(normalizePhone("1234567")).toBeNull();
    expect(normalizePhone("12345678")).toBe("12345678");
    expect(normalizePhone("123456789012345")).toBe("123456789012345");
    expect(normalizePhone("1234567890123456")).toBeNull();
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone("abc")).toBeNull();
  });

  it("ignores a + that isn't first and letters", () => {
    expect(normalizePhone("62+812 3456 7890")).toBe("6281234567890");
    expect(normalizePhone("tel: +62 812 3456 7890")).toBe("6281234567890");
  });

  it("'+0…' keeps the 0 instead of swapping in the country code (current behaviour)", () => {
    // The + branch wins and the leading 0 is never looked at again (humans.ts:19-21).
    expect(normalizePhone("+081234567890", "id")).toBe("081234567890");
  });
});

describe("humanJid", () => {
  it("builds the WhatsApp JID", () => {
    expect(humanJid("6281234567890")).toBe("6281234567890@s.whatsapp.net");
  });
});
