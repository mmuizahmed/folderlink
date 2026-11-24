import { describe, expect, it } from "vitest";
import { appIdentity } from "./apps.ts";

describe("appIdentity", () => {
  it("maps the known clients by registered name", () => {
    expect(appIdentity("ChatGPT")).toBe("chatgpt");
    expect(appIdentity("OpenAI ChatGPT")).toBe("chatgpt");
    expect(appIdentity("Claude")).toBe("claude");
    expect(appIdentity("Anthropic Claude")).toBe("claude");
    expect(appIdentity("Muse")).toBe("muse");
  });

  it("is case-insensitive and never guesses", () => {
    expect(appIdentity("CHATGPT")).toBe("chatgpt");
    expect(appIdentity("Some Other Client")).toBe("unknown");
    expect(appIdentity("")).toBe("unknown");
    expect(appIdentity(null)).toBe("unknown");
    expect(appIdentity(undefined)).toBe("unknown");
  });
});
