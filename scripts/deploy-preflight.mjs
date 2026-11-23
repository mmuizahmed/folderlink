import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const PLACEHOLDER = "00000000-0000-0000-0000-000000000001";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function productionBlock(toml) {
  const lines = [];
  let inside = false;
  for (const line of toml.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("[")) {
      inside = trimmed.includes("env.production");
    }
    if (inside) {
      lines.push(line);
    }
  }
  return lines.join("\n");
}

export function productionProblems(toml) {
  const problems = [];
  const production = productionBlock(toml);
  if (!production.includes("[env.production]")) {
    problems.push("wrangler.toml has no [env.production] section.");
    return problems;
  }
  const databaseId = production.match(/database_id\s*=\s*"([^"]*)"/)?.[1] ?? "";
  if (!databaseId) {
    problems.push("database_id is missing from [env.production].");
  } else if (databaseId === PLACEHOLDER) {
    problems.push(
      `database_id in [env.production] is still the placeholder ${PLACEHOLDER}. Run \`wrangler d1 create folderlink\` and paste the id into wrangler.toml.`,
    );
  } else if (!UUID.test(databaseId)) {
    problems.push(`database_id in [env.production] is not a UUID: ${databaseId}.`);
  }
  for (const key of ["WEB_ORIGIN", "PUBLIC_BASE_URL"]) {
    const match = production.match(new RegExp(`${key}\\s*=\\s*"([^"]*)"`));
    const value = match?.[1] ?? "";
    if (!value) {
      problems.push(`${key} is missing from [env.production].`);
      continue;
    }
    if (/localhost|127\.0\.0\.1/i.test(value)) {
      problems.push(`${key} in [env.production] still points at ${value}.`);
    }
  }
  if (/^\s*DEV_AUTH\s*=/m.test(production)) {
    problems.push("DEV_AUTH is set in the production config.");
  }
  return problems;
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  const toml = readFileSync(new URL("../apps/worker/wrangler.toml", import.meta.url), "utf8");
  const problems = productionProblems(toml);
  if (problems.length > 0) {
    for (const problem of problems) {
      console.error(`preflight: ${problem}`);
    }
    process.exit(1);
  }
  console.log("preflight: production config ok");
}
