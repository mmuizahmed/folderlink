import { describe, expect, it } from "vitest";
import { parseEnvelope, parseHelloPayload, parsePairBeginPayload } from "./protocol.ts";

const folder = { id: "11111111-1111-4111-8111-111111111111", label: "notes" };

describe("protocol parsers", () => {
  it("parses a hello payload", () => {
    const parsed = parseHelloPayload({
      op: "hello",
      protocol: 1,
      deviceId: "22222222-2222-4222-8222-222222222222",
      publicKey: "A".repeat(43),
      name: "laptop",
      version: "0.1.0",
      ts: 1_700_000_000,
      nonce: "abcdefABCDEF0123",
      folders: [folder],
    });
    expect(parsed?.folders[0]?.label).toBe("notes");
  });

  it("rejects a hello that is missing its signature material", () => {
    expect(parseHelloPayload({ op: "hello", protocol: 1 })).toBeNull();
    expect(parsePairBeginPayload({ op: "pair_status" })).toBeNull();
  });

  it("rejects an unknown message type", () => {
    expect(parseEnvelope({ v: 1, type: "exec", id: "1" })).toBeNull();
    expect(parseEnvelope({ v: 2, type: "ping", id: "1" })).toBeNull();
  });
});
