import type { Env } from "../env.ts";
import { publicBaseUrl } from "../env.ts";

export function googleConfigured(env: Env): boolean {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.PUBLIC_BASE_URL);
}

export function googleRedirectUri(env: Env): string {
  return new URL("/api/auth/google/callback", publicBaseUrl(env)).toString();
}

export function googleAuthURL(env: Env, state: string): string {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", env.GOOGLE_CLIENT_ID ?? "");
  url.searchParams.set("redirect_uri", googleRedirectUri(env));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", state);
  url.searchParams.set("prompt", "select_account");
  return url.toString();
}

export interface GoogleProfile {
  sub: string;
  email: string;
  name: string;
  picture: string;
}

export async function exchangeGoogleCode(env: Env, code: string): Promise<GoogleProfile> {
  const body = new URLSearchParams({
    code,
    client_id: env.GOOGLE_CLIENT_ID ?? "",
    client_secret: env.GOOGLE_CLIENT_SECRET ?? "",
    redirect_uri: googleRedirectUri(env),
    grant_type: "authorization_code",
  });
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!tokenRes.ok) {
    throw new Error("google token exchange failed");
  }
  const token = (await tokenRes.json()) as { access_token?: string };
  if (!token.access_token) {
    throw new Error("google token exchange failed");
  }
  const profileRes = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { authorization: `Bearer ${token.access_token}` },
  });
  if (!profileRes.ok) {
    throw new Error("google profile lookup failed");
  }
  const profile = (await profileRes.json()) as {
    sub?: string;
    email?: string;
    name?: string;
    picture?: string;
  };
  if (!profile.sub || !profile.email) {
    throw new Error("google profile was incomplete");
  }
  return {
    sub: profile.sub,
    email: profile.email,
    name: profile.name ?? profile.email,
    picture: profile.picture ?? "",
  };
}
