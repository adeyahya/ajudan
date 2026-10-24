import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ajudan-voice-"));
process.env.AJUDAN_DATA_DIR = dir;
// A stand-in voice install, so voiceAvailable() is true without the real model.
const voiceDir = path.join(dir, "voice");
fs.mkdirSync(path.join(voiceDir, ".venv", "bin"), { recursive: true });
fs.writeFileSync(path.join(voiceDir, ".venv", "bin", "python"), "");
fs.writeFileSync(path.join(voiceDir, ".ready"), "");
process.env.AJUDAN_VOICE_DIR = voiceDir;

const { db, schema } = await import("@/db");
const { speakable, voiceAvailable } = await import("@/lib/voice");
const { voiceSettings } = await import("@/lib/voice-settings");
const { wantsVoice } = await import("../worker/humans");

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("speakable", () => {
  it("drops markdown, links, emoji and list marks, keeping the words", () => {
    expect(speakable("**Siap Pak!** Laporan hari ini:\n- 3 pesanan baru\n- 1 pertanyaan ongkir 🚚\nDetail: https://example.com/laporan")).toBe(
      "Siap Pak! Laporan hari ini: 3 pesanan baru. 1 pertanyaan ongkir.",
    );
    expect(speakable("Lihat [katalog](https://x.id/k) ya 🙏")).toBe("Lihat katalog ya");
  });

  it("cuts a long message at a sentence", () => {
    const long = Array.from({ length: 40 }, (_, i) => `Kalimat nomor ${i} di sini.`).join(" ");
    const out = speakable(long);
    expect(out.length).toBeLessThanOrEqual(600);
    expect(out.endsWith(".")).toBe(true);
  });
});

describe("when the team answers with a voice note", () => {
  const biz = db.insert(schema.businesses).values({ name: "Oru", status: "active" }).returning().get();
  const owner = db.insert(schema.teammates).values({ businessId: biz.id, name: "Ade", roleKey: "human", title: "Owner", kind: "human", phone: "+6281200000000", status: "active" }).returning().get();
  const said = (text: string, at: number) =>
    db.insert(schema.humanMessages).values({ businessId: biz.id, humanId: owner.id, direction: "in", text, sentAt: new Date(at) }).run();
  const set = (mode: "off" | "mirror" | "always") => db.update(schema.businesses).set({ voiceReplies: { mode } }).run();

  it("defaults to off", () => {
    expect(voiceAvailable()).toBe(true);
    expect(voiceSettings(null)).toMatchObject({ mode: "off", instruct: "female, young adult, moderate pitch" });
    said("🎤 halo, laporan hari ini gimana?", 1000);
    expect(wantsVoice(biz.id, owner.id)).toBe(false);
  });

  it("mirrors: a voice note back only when their last message was one", () => {
    set("mirror");
    expect(wantsVoice(biz.id, owner.id)).toBe(true);
    said("oke, tulis aja", 2000);
    expect(wantsVoice(biz.id, owner.id)).toBe(false);
  });

  it("always: every message", () => {
    set("always");
    expect(wantsVoice(biz.id, owner.id)).toBe(true);
  });
});
