import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

process.env.AJUDAN_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ajudan-oa-"));
const { isApprovalAnswer, parseAnswer } = await import("../worker/owner-approvals");

/** What handleOwnerAnswers extracts; by default every 4-character word is an open code. */
const parse = (text: string, isOpenCode: (code: string) => boolean = () => true) => parseAnswer(text, isOpenCode);

describe("YES", () => {
  it.each(["ya", "iya", "y", "yes", "ok", "oke", "okay", "setuju", "approve", "approved", "acc", "gas", "lanjut", "boleh"])("accepts %j", (w) => {
    expect(parse(w)).toEqual({ decision: "approved", target: "", note: "" });
  });

  it("ignores case, surrounding whitespace and trailing punctuation", () => {
    expect(parse("Ya")).toMatchObject({ decision: "approved" });
    expect(parse("  IYA  ")).toMatchObject({ decision: "approved" });
    expect(parse("ok.")).toMatchObject({ decision: "approved", target: "", note: "" });
    expect(parse("Setuju!")).toMatchObject({ decision: "approved", target: "", note: "" });
    expect(parse("oke, ")).toMatchObject({ decision: "approved", target: "", note: "" });
  });

  it("reads the approval code after the word", () => {
    expect(parse("ya A7F2")).toEqual({ decision: "approved", target: "a7f2", note: "" });
    expect(parse("Ya #a7f2")).toEqual({ decision: "approved", target: "a7f2", note: "" });
    expect(parse("ok, A7F2.")).toEqual({ decision: "approved", target: "a7f2", note: "" });
    expect(parse("setuju 1234")).toEqual({ decision: "approved", target: "1234", note: "" });
  });

  it("keeps the rest as a note", () => {
    expect(parse("ya A7F2 tapi kecilkan logonya")).toEqual({ decision: "approved", target: "a7f2", note: "tapi kecilkan logonya" });
    expect(parse("ok - a7f2: kirim besok")).toEqual({ decision: "approved", target: "a7f2", note: "kirim besok" });
    expect(parse("ya, kirim sekarang")).toEqual({ decision: "approved", target: "", note: "kirim sekarang" });
    expect(parse("ya\nkirim\nsekarang")).toEqual({ decision: "approved", target: "", note: "kirim\nsekarang" });
  });

  it("understands 'semua' / 'all'", () => {
    expect(parse("ya semua")).toEqual({ decision: "approved", target: "semua", note: "" });
    expect(parse("Setuju semua!")).toEqual({ decision: "approved", target: "semua", note: "" });
    expect(parse("approve all")).toEqual({ decision: "approved", target: "all", note: "" });
  });

  it("needs a word boundary: longer words starting with a yes-word aren't answers", () => {
    expect(parse("yakin?")).toBeNull();
    expect(parse("yang mana?")).toBeNull();
    expect(parse("okelah nanti")).toBeNull();
    expect(parse("gasket")).toBeNull();
    expect(parse("accurate")).toBeNull();
    expect(parse("bolehkah")).toBeNull();
  });

  it("a 5-character hex word is not a code", () => {
    expect(parse("ok abcde")).toEqual({ decision: "approved", target: "", note: "abcde" });
  });
});

describe("NO", () => {
  it.each(["tidak", "nggak", "gak", "enggak", "ga", "no", "n", "tolak", "reject", "rejected", "jangan", "batal"])("accepts %j", (w) => {
    expect(parse(w)).toEqual({ decision: "rejected", target: "", note: "" });
  });

  it("reads code, case and punctuation like YES", () => {
    expect(parse("Tidak A7F2 terlalu mahal")).toEqual({ decision: "rejected", target: "a7f2", note: "terlalu mahal" });
    expect(parse("NGGAK, #A7F2.")).toEqual({ decision: "rejected", target: "a7f2", note: "" });
    expect(parse("ga usah")).toEqual({ decision: "rejected", target: "", note: "usah" });
    expect(parse("tolak semua")).toEqual({ decision: "rejected", target: "semua", note: "" });
  });

  it("needs a word boundary", () => {
    expect(parse("nanti")).toBeNull();
    expect(parse("gajian")).toBeNull();
    expect(parse("batalkan")).toBeNull();
    expect(parse("nomor 5")).toBeNull();
    expect(parse("garansi")).toBeNull();
  });
});

describe("neither", () => {
  it.each(["", "   ", "halo", "bikin post buat TikTok", "1234", "A7F2 ya", "mungkin"])("%j is not an answer", (t) => {
    expect(parse(t)).toBeNull();
    expect(isApprovalAnswer(t)).toBe(false);
  });
});

describe("isApprovalAnswer", () => {
  it("is true for yes and no answers", () => {
    expect(isApprovalAnswer("ya")).toBe(true);
    expect(isApprovalAnswer("tidak A7F2 kemahalan")).toBe(true);
    expect(isApprovalAnswer("OK semua")).toBe(true);
  });

  it("reads a transcribed voice answer", () => {
    expect(isApprovalAnswer("🎤 ya")).toBe(true);
  });
});

describe("ambiguous answers", () => {
  const none = () => false;
  it("a 4-letter hex-looking word that isn't an open code is part of the note", () => {
    expect(parse("ok cabe 5kg", none)).toEqual({ decision: "approved", target: "", note: "cabe 5kg" });
    expect(parse("ya beda dikit", none)).toEqual({ decision: "approved", target: "", note: "beda dikit" });
    expect(parse("ok 1000 pcs", none)).toEqual({ decision: "approved", target: "", note: "1000 pcs" });
  });
  it("a code that mixes digits and letters stays a code even when it's not open", () => {
    expect(parse("ya A7F2", none)).toEqual({ decision: "approved", target: "a7f2", note: "" });
  });
  it("a refusal right after a yes-word is a refusal", () => {
    expect(parse("ya tidak jadi")).toMatchObject({ decision: "rejected", note: "jadi" });
    expect(parse("iya, jangan dulu")).toMatchObject({ decision: "rejected" });
    expect(parse("ya tidak A7F2 kemahalan")).toEqual({ decision: "rejected", target: "a7f2", note: "kemahalan" });
  });
  it("'it's fine' after a yes-word stays a yes", () => {
    expect(parse("ok gapapa")).toMatchObject({ decision: "approved" });
    expect(parse("ya ga papa")).toMatchObject({ decision: "approved" });
    expect(parse("oke tidak masalah")).toMatchObject({ decision: "approved" });
  });
  it("'ya?' is a question, not an approval", () => {
    expect(parse("ya?")).toBeNull();
    expect(isApprovalAnswer("ya?")).toBe(false);
  });
});
