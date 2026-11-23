// Canonical JSON for signatures.
// Objects have sorted keys, there is no insignificant whitespace, and strings
// use the same escapes as JSON.stringify. Only safe integers are accepted so
// Go and JavaScript cannot disagree about a number's spelling.

export function canonicalJSON(value: unknown): string {
  return writeValue(value);
}

function writeValue(value: unknown): string {
  if (value === null) {
    return "null";
  }
  switch (typeof value) {
    case "string":
      return JSON.stringify(value);
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isSafeInteger(value)) {
        throw new Error("canonical JSON only accepts safe integers");
      }
      return String(value);
    case "object":
      break;
    default:
      throw new Error("unsupported canonical JSON value");
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => writeValue(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const body = keys.map((key) => `${JSON.stringify(key)}:${writeValue(record[key])}`).join(",");
  return `{${body}}`;
}
