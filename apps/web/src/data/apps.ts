import type { AppIdentity, AppView } from "./types.ts";
import chatgptLogo from "../assets/brands/chatgpt.svg";
import claudeLogo from "../assets/brands/claude.svg";

// identityFromServer normalizes the identity string the worker sends
// (chatgpt / claude / muse / unknown). Anything unrecognised is unknown:
// the dashboard never guesses a brand.
export function identityFromServer(value: string | null | undefined): AppIdentity {
  if (value === "chatgpt" || value === "claude" || value === "muse") {
    return value;
  }
  return "unknown";
}

// toneForIdentity picks the mark styling for an app identity. The tone
// names are the CSS classes in styles.css (.app-mark.gpt and friends).
export function toneForIdentity(identity: AppIdentity): AppView["tone"] {
  switch (identity) {
    case "chatgpt":
      return "gpt";
    case "claude":
      return "claude";
    case "muse":
      return "muse";
    default:
      return "unknown";
  }
}

// markForIdentity is the neutral fallback mark: the app's initial letter.
// It is what the dashboard shows when no real brand SVG is bundled for
// that identity (muse has no clean public SVG source yet; unknown has no
// brand). The mark must never be fabricated.
export function markForIdentity(identity: AppIdentity): string {
  switch (identity) {
    case "chatgpt":
      return "GPT";
    case "claude":
      return "C";
    case "muse":
      return "M";
    default:
      return "?";
  }
}

// logoForIdentity returns the bundled real brand mark for an identity, or
// null when none is available. Sources: chatgpt.svg is the ChatGPT logo
// from Wikimedia Commons; claude.svg is the Claude mark from simple-icons
// (single-colour path, so it is rendered inverted to white on the coral
// chip). A null result means the caller falls back to markForIdentity.
export function logoForIdentity(identity: AppIdentity): {
  src: string;
  invert: boolean;
} | null {
  switch (identity) {
    case "chatgpt":
      return { src: chatgptLogo, invert: false };
    case "claude":
      return { src: claudeLogo, invert: true };
    default:
      return null;
  }
}
