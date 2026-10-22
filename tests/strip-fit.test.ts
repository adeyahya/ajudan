import { describe, expect, it } from "vitest";
import { MAX_OVERSCAN, stripFit } from "@/app/b/[id]/_chat/strip-fit";

describe("office strip fit", () => {
  it("fills the width and crops around the desks when the room is much taller than the strip", () => {
    const f = stripFit(900, 230, 384, 256, 128);
    expect(f.height).toBeCloseTo(230 * MAX_OVERSCAN);
    expect(f.width).toBeCloseTo(384 * (f.height / 256));
    // Cropped, never leaving a gap above or below.
    expect(f.top).toBeLessThanOrEqual(0);
    expect(f.top + f.height).toBeGreaterThanOrEqual(230);
  });
  it("centres the focus row when it can", () => {
    const f = stripFit(384, 230, 384, 320, 160); // scale 1: the room is 320 tall
    expect(f.top).toBeCloseTo(115 - 160);
  });
  it("letterboxes a narrow frame", () => {
    const f = stripFit(300, 230, 384, 256, 128);
    expect(f.width).toBe(300);
    expect(f.left).toBe(0);
    expect(f.top).toBeCloseTo((230 - f.height) / 2);
  });
});
