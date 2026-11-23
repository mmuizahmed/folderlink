import { describe, expect, it } from "vitest";
import {
  authorizeGet,
  authorizePost,
  pkceS256,
  protectedResourceMetadata,
  registerClient,
  type OAuthClient,
  type OAuthCode,
  type OAuthGrant,
  type OAuthStore,
} from "./oauth.ts";

function memoryStore(): OAuthStore & { codes: Map<string, OAuthCode & { used: boolean }> } {
  const clients = new Map<string, OAuthClient>();
  const codes = new Map<string, OAuthCode & { used: boolean }>();
  const grants: OAuthGrant[] = [];
  return {
    codes,
    async saveClient(client) {
      clients.set(client.id, client);
    },
    async client(id) {
      return clients.get(id) ?? null;
    },
    async saveCode(hash, code) {
      codes.set(hash, { ...code, used: false });
    },
    async takeCode(hash, now) {
      const row = codes.get(hash);
      if (!row || row.used || row.expiresAt <= now) return null;
      row.used = true;
      return row;
    },
    async saveGrant(grant) {
      grants.push(grant);
    },
    async grantForFamily(familyId) {
      return grants.find((grant) => grant.familyId === familyId) ?? null;
    },
    async grantsForUser(userId) {
      return grants.filter((grant) => grant.userId === userId && !grant.revokedAt);
    },
    async revokeGrant(id, userId, at) {
      const grant = grants.find(
        (item) => item.id === id && item.userId === userId && !item.revokedAt,
      );
      if (!grant) return null;
      grant.revokedAt = at;
      return grant;
    },
  };
}

const origin = "https://folderlink.muiz.pk";

describe("MCP OAuth", () => {
  it("publishes the resource and S256 PKCE vector", async () => {
    expect(protectedResourceMetadata(origin).resource).toBe("https://folderlink.muiz.pk/mcp");
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    expect(await pkceS256(verifier)).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  it("registers a public client and shows a consent screen", async () => {
    const store = memoryStore();
    const created = await registerClient(
      new Request("https://folderlink.muiz.pk/oauth/register", {
        method: "POST",
        body: JSON.stringify({
          client_name: "ChatGPT",
          redirect_uris: ["https://chatgpt.com/connector/oauth/callback"],
          token_endpoint_auth_method: "none",
        }),
      }),
      store,
    );
    expect(created.status).toBe(201);
    const client = (await created.json()) as { client_id: string };
    const challenge = await pkceS256("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk");
    const query = new URLSearchParams({
      response_type: "code",
      client_id: client.client_id,
      redirect_uri: "https://chatgpt.com/connector/oauth/callback",
      code_challenge: challenge,
      code_challenge_method: "S256",
      state: "xyz",
      scope: "folderlink:read",
      resource: "https://folderlink.muiz.pk/mcp",
    });
    const page = await authorizeGet(
      new Request(`https://folderlink.muiz.pk/oauth/authorize?${query}`),
      store,
      { id: "user-1", email: "muiz@example.com", name: "Muiz Ahmed" },
      origin,
    );
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain("Allow ChatGPT");
    expect(html).toContain("chatgpt.com");
    expect(html).toContain("muiz@example.com");
    expect(html).toContain("Not you?");
    expect(html).toContain("Read folders you approve");
    const denied = await authorizePost(
      new Request("https://folderlink.muiz.pk/oauth/authorize", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ ...Object.fromEntries(query), decision: "deny" }),
      }),
      store,
      { id: "user-1" },
      origin,
    );
    expect(denied.status).toBe(302);
    expect(denied.headers.get("location")).toContain("error=access_denied");
    const allowed = await authorizePost(
      new Request("https://folderlink.muiz.pk/oauth/authorize", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ ...Object.fromEntries(query), decision: "allow" }),
      }),
      store,
      { id: "user-1" },
      origin,
    );
    const location = new URL(allowed.headers.get("location") ?? "");
    expect(location.searchParams.get("code")).toBeTruthy();
    expect(location.searchParams.get("state")).toBe("xyz");
  });

  it("rejects a non-https redirect", async () => {
    const response = await registerClient(
      new Request("https://folderlink.muiz.pk/oauth/register", {
        method: "POST",
        body: JSON.stringify({ redirect_uris: ["http://evil.example/back"] }),
      }),
      memoryStore(),
    );
    expect(response.status).toBe(400);
  });
});
