import { spawnSync } from "node:child_process";

const apply = process.argv.includes("--apply");
const steps = [
  "pnpm --filter @mcp-bridge/web build",
  "pnpm --filter @mcp-bridge/worker exec wrangler d1 create folderlink",
  "Paste the printed database id into apps/worker/wrangler.toml under [env.production].",
  "pnpm --filter @mcp-bridge/worker exec wrangler d1 migrations apply folderlink --env production --remote",
  "pnpm --filter @mcp-bridge/worker exec wrangler secret put GOOGLE_CLIENT_ID --env production",
  "pnpm --filter @mcp-bridge/worker exec wrangler secret put GOOGLE_CLIENT_SECRET --env production",
  "node scripts/deploy-preflight.mjs",
  "pnpm --filter @mcp-bridge/worker exec wrangler deploy --env production",
];

console.log("FolderLink self-host. Review apps/worker/wrangler.toml before the deploy step.");
for (const step of steps) {
  console.log(`\n$ ${step}`);
}

if (!apply) {
  console.log("\nRe-run with --apply to execute the wrangler commands in this terminal.");
  process.exit(0);
}

for (const step of steps) {
  if (step.startsWith("Paste ") || step.startsWith("Review ")) continue;
  const result = spawnSync(step, { shell: true, stdio: "inherit" });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
