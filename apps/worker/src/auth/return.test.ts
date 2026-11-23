import { describe, expect, it } from "vitest";
import { nextFromLoginState, packLoginState, safeNext } from "./return.ts";

describe("sign-in return path", () => {
  it("keeps a same-site path and query", () => {
    expect(safeNext("/pair?code=K7QM-2XPA")).toBe("/pair?code=K7QM-2XPA");
  });

  it("drops an off-site return path", () => {
    expect(safeNext("https://evil.example/pair")).toBe("/dashboard");
    expect(safeNext("//evil.example/pair")).toBe("/dashboard");
    expect(safeNext("/\\evil.example")).toBe("/dashboard");
  });

  it("round-trips the path through the login state", () => {
    const state = packLoginState("st_abc", "/pair?code=K7QM-2XPA");
    expect(nextFromLoginState(state)).toBe("/pair?code=K7QM-2XPA");
  });
});
