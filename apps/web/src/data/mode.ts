export type ScreenMode = "live" | "fixture" | "empty" | "error" | "loading" | "offline" | "long";

export function screenMode(
  search = typeof location === "undefined" ? "" : location.search,
): ScreenMode {
  const value = new URLSearchParams(search).get("fixture");
  if (
    value === "empty" ||
    value === "error" ||
    value === "loading" ||
    value === "offline" ||
    value === "long"
  ) {
    return value;
  }
  if (value === "1") {
    return "fixture";
  }
  return "live";
}

export function initials(name: string, email: string): string {
  const source = name.trim() || email;
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`.toUpperCase();
  }
  return source.slice(0, 2).toUpperCase();
}
