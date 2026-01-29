import chalk from "chalk";
import { loadConfig } from "../utils/config.js";
import { keyExists } from "../crypto/keys.js";
import {
  getResourceHandler,
  ALL_RESOURCE_TYPES,
  RESOURCE_CONFIGS,
} from "../resources/index.js";

export async function status(): Promise<void> {
  console.log(chalk.bold("\nClaude Sync Status\n"));

  // Check initialization
  const config = await loadConfig();

  if (!config?.initialized) {
    console.log(chalk.red("Status: Not initialized"));
    console.log(chalk.dim("Run `claude-sync init` to get started\n"));
    return;
  }

  console.log(chalk.green("Status: Initialized"));
  console.log();

  // Backend info
  console.log(chalk.bold("Backend:"));
  console.log(`  Type: ${config.backend}`);
  if (config.backend === "git") {
    console.log(`  URL: ${config.backendConfig.url}`);
  } else if (config.backend === "s3") {
    console.log(`  Bucket: ${config.backendConfig.bucket}`);
    if (config.backendConfig.endpoint) {
      console.log(`  Endpoint: ${config.backendConfig.endpoint}`);
    }
  }
  console.log();

  // Encryption
  console.log(chalk.bold("Encryption:"));
  const hasKey = await keyExists();
  if (hasKey) {
    console.log(chalk.green("  Key configured"));
  } else {
    console.log(chalk.red("  No key found"));
  }
  console.log();

  // Resource counts
  console.log(chalk.bold("Resources:"));

  for (const type of ALL_RESOURCE_TYPES) {
    const handler = getResourceHandler(type);
    const typeConfig = RESOURCE_CONFIGS[type];

    try {
      const allResources = await handler.findLocal();
      const pendingResources = await handler.findLocal({ modifiedSinceLastSync: true });

      console.log(`  ${typeConfig.displayName}:`);
      console.log(`    Local: ${allResources.length}`);
      console.log(`    Pending sync: ${pendingResources.length}`);
    } catch {
      console.log(`  ${typeConfig.displayName}:`);
      console.log(chalk.dim(`    Unable to read`));
    }
  }
  console.log();

  // Created date
  if (config.createdAt) {
    console.log(
      chalk.dim(`Initialized: ${new Date(config.createdAt).toLocaleDateString()}`)
    );
  }
  console.log();
}
