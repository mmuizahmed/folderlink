const CANONICAL = "https://folderlink.muiz.pk";

export function safeNext(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return "/dashboard";
  }
  let url: URL;
  try {
    url = new URL(value, CANONICAL);
  } catch {
    return "/dashboard";
  }
  if (url.origin !== CANONICAL || url.username || url.password) {
    return "/dashboard";
  }
  return `${url.pathname}${url.search}`;
}

export function packLoginState(token: string, next: string): string {
  return `${token}.${encodeURIComponent(safeNext(next))}`;
}

export function nextFromLoginState(state: string): string {
  const dot = state.indexOf(".");
  if (dot === -1) {
    return "/dashboard";
  }
  try {
    return safeNext(decodeURIComponent(state.slice(dot + 1)));
  } catch {
    return "/dashboard";
  }
}
