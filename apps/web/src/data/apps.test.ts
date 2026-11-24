import { describe, expect, it } from "vitest";
import { identityFromServer, logoForIdentity, markForIdentity, toneForIdentity } from "./apps.ts";

describe("identityFromServer", () => {
  it("passes the known identities through and never guesses", () => {
    expect(identityFromServer("chatgpt")).toBe("chatgpt");
    expect(identityFromServer("claude")).toBe("claude");
    expect(identityFromServer("muse")).toBe("muse");
    expect(identityFromServer("mcp")).toBe("unknown");
    expect(identityFromServer("")).toBe("unknown");
    expect(identityFromServer(null)).toBe("unknown");
    expect(identityFromServer(undefined)).toBe("unknown");
  });
});

describe("toneForIdentity", () => {
  it("maps chatgpt to the gpt mark styling", () => {
    expect(toneForIdentity("chatgpt")).toBe("gpt");
    expect(toneForIdentity("claude")).toBe("claude");
    expect(toneForIdentity("muse")).toBe("muse");
    expect(toneForIdentity("unknown")).toBe("unknown");
  });
});

describe("markForIdentity", () => {
  it("returns the neutral fallback letter for every identity", () => {
    expect(markForIdentity("chatgpt")).toBe("GPT");
    expect(markForIdentity("claude")).toBe("C");
    expect(markForIdentity("muse")).toBe("M");
    expect(markForIdentity("unknown")).toBe("?");
  });
});

describe("logoForIdentity", () => {
  it("returns a bundled logo for chatgpt and claude, and null otherwise", () => {
    // Vite inlines these small SVGs as data URIs (or serves them as
    // files in other environments), so assert on the content, not the
    // exact URL shape.
    const chatgpt = logoForIdentity("chatgpt");
    expect(chatgpt).not.toBeNull();
    expect(chatgpt?.src).toMatch(/data:image\/svg\+xml,|chatgpt\.svg$/);
    expect(chatgpt?.src).toContain("74aa9c");
    expect(chatgpt?.invert).toBe(false);
    const claude = logoForIdentity("claude");
    expect(claude).not.toBeNull();
    expect(claude?.src).toMatch(/data:image\/svg\+xml,|claude\.svg$/);
    expect(claude?.src).toContain("Claude");
    expect(claude?.invert).toBe(true);
    expect(logoForIdentity("muse")).toBeNull();
    expect(logoForIdentity("unknown")).toBeNull();
  });
});
