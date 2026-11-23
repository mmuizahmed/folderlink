export function formatWhen(iso: string | null, now = Date.now()): string {
  if (!iso) {
    return "Never";
  }
  const then = Date.parse(iso);
  if (Number.isNaN(then)) {
    return "Unknown";
  }
  const seconds = Math.max(0, Math.floor((now - then) / 1000));
  if (seconds < 10) {
    return "Just now";
  }
  if (seconds < 60) {
    return `${seconds}s ago`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 48) {
    return `${hours}h ago`;
  }
  return new Date(then).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
