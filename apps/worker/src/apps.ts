// AppIdentity names the AI app behind an OAuth grant, from the OAuth
// client's registered name. It is attribution only — a label for the
// dashboard and the activity log. Authorization uses the grant id, never
// the name, because the name is self-asserted by the client when it
// registers. An unrecognised client gets "unknown", never a guessed brand.
export type AppIdentity = "chatgpt" | "claude" | "muse" | "unknown";

export function appIdentity(clientName: string | null | undefined): AppIdentity {
  const name = (clientName ?? "").toLowerCase();
  if (name.includes("chatgpt") || name.includes("openai")) {
    return "chatgpt";
  }
  if (name.includes("claude") || name.includes("anthropic")) {
    return "claude";
  }
  if (name.includes("muse")) {
    return "muse";
  }
  return "unknown";
}
