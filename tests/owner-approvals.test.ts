import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

process.env.AJUDAN_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ajudan-oa-"));
const { NO, YES, isApprovalAnswer } = await import("../worker/owner-approvals");

/** What handleOwnerAnswers extracts: the decision, the code/"semua"/"all" target and the note. */
function parse(text: string) {
  const yes = YES.exec(text);
  const m = yes ?? NO.exec(text);
  if (!m) return null;
  return { decision: yes ? "approved" : "rejected", target: (m[2] ?? "").replace("#", "").toLowerCase(), note: (m[3] ?? "").trim() };
}

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

  it("doesn't strip the voice-note prefix that handleOwnerAnswers strips (current behaviour)", () => {
    // handleOwnerAnswers removes a leading "🎤 " before matching; isApprovalAnswer doesn't,
    // so a transcribed voice "ya" still goes through the normal wait.
    expect(isApprovalAnswer("🎤 ya")).toBe(false);
  });
});

describe("known weak spots in the regexes (owner-approvals.ts:15-16)", () => {
  // Recorded as it.fails: these document reasonable inputs the current regexes get wrong.
  // handleOwnerAnswers only rescues an all-digit false code (a 4-digit number that isn't a
  // pending code is dropped); a 4-letter hex word like "cabe", "beda", "baca" or "face" is
  // taken as the code and the owner is told it isn't found.
  it.fails("a 4-letter hex-looking Indonesian word after 'ok' is not a code", () => {
    expect(parse("ok cabe 5kg")).toEqual({ decision: "approved", target: "", note: "cabe 5kg" });
  });
  it.fails("'ya beda dikit' is a yes with a note, not code 'beda'", () => {
    expect(parse("ya beda dikit")).toEqual({ decision: "approved", target: "", note: "beda dikit" });
  });
  // YES is tried before NO, so a yes-word followed by a refusal still approves.
  it.fails("'ya tidak jadi' is a refusal", () => {
    expect(parse("ya tidak jadi")).toMatchObject({ decision: "rejected" });
  });
  it.fails("'iya, jangan dulu' is a refusal", () => {
    expect(parse("iya, jangan dulu")).toMatchObject({ decision: "rejected" });
  });
  // "?" is not in the separator class, so "ya?" (a question) approves with note "?".
  it.fails("'ya?' is a question, not an approval", () => {
    expect(parse("ya?")).toBeNull();
  });
});
