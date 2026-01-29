import ora from "ora";
import chalk from "chalk";
import { decrypt } from "../crypto/encrypt.js";
import { getBackend } from "../backends/index.js";
import { loadConfig } from "../utils/config.js";
import {
  getResourceHandler,
  ALL_RESOURCE_TYPES,
  RESOURCE_CONFIGS,
  type ResourceType,
} from "../resources/index.js";

interface PullOptions {
  type?: ResourceType;
  session?: string;
  all?: boolean;
  dryRun?: boolean;
}

export async function pull(options: PullOptions): Promise<void> {
  const config = await loadConfig();

  if (!config?.initialized) {
    console.log(
      chalk.red("Error: claude-sync not initialized. Run `claude-sync init` first.")
    );
    process.exit(1);
  }

  if (options.dryRun) {
    console.log(chalk.bold("\nDry Run - Preview of resources to pull:\n"));
  }

  const backend = await getBackend(config);

  // Determine which types to pull
  const typesToPull: ResourceType[] = options.type
    ? [options.type]
    : options.all
    ? ALL_RESOURCE_TYPES
    : ["sessions"]; // Default to sessions for backwards compatibility

  // Handle legacy session-specific options
  if (options.session) {
    if (options.type && options.type !== "sessions") {
      console.log(
        chalk.red("Error: --session option is only valid for sessions type")
      );
      process.exit(1);
    }
    await pullSpecificSession(options.session, backend, options.dryRun);
    return;
  }

  // Pull each resource type
  for (const resourceType of typesToPull) {
    await pullResourceType(resourceType, options, backend);
  }

  if (options.dryRun) {
    console.log(chalk.dim("\nRun without --dry-run to actually pull these resources."));
  }
}

async function pullSpecificSession(
  sessionId: string,
  backend: Awaited<ReturnType<typeof getBackend>>,
  dryRun?: boolean
): Promise<void> {
  const handler = getResourceHandler("sessions");
  const spinner = dryRun ? null : ora("Pulling session...").start();

  try {
    const remoteResources = await backend.listResources("sessions");
    const resource = remoteResources.find((r) => r.id === sessionId);

    if (!resource) {
      if (spinner) {
        spinner.fail(`Session ${sessionId} not found on remote`);
      } else {
        console.log(chalk.red(`Session ${sessionId} not found on remote`));
      }
      return;
    }

    if (dryRun) {
      console.log(chalk.cyan("Sessions:"));
      console.log(`  ${chalk.yellow("↓")} ${resource.id}`);
      return;
    }

    const encrypted = await backend.pullResource("sessions", sessionId);
    const decrypted = await decrypt(encrypted);
    await handler.write(sessionId, Buffer.from(decrypted, "utf-8"), resource.metadata);

    spinner!.succeed(`Pulled session ${sessionId}`);
  } catch (error) {
    if (spinner) {
      spinner.fail(`Failed to pull session: ${error}`);
    } else {
      console.log(chalk.red(`Failed to pull session: ${error}`));
    }
    process.exit(1);
  }
}

async function pullResourceType(
  type: ResourceType,
  options: PullOptions,
  backend: Awaited<ReturnType<typeof getBackend>>
): Promise<void> {
  const handler = getResourceHandler(type);
  const typeConfig = RESOURCE_CONFIGS[type];

  const spinner = options.dryRun
    ? null
    : ora(`Fetching ${typeConfig.displayName.toLowerCase()} from remote...`).start();

  try {
    // Get list of remote resources
    const remoteResources = await backend.listResources(type);

    if (remoteResources.length === 0) {
      if (options.dryRun) {
        console.log(chalk.cyan(`${typeConfig.displayName}:`));
        console.log(chalk.dim("  No resources on remote"));
        console.log();
      } else {
        spinner!.succeed(`No ${typeConfig.displayName.toLowerCase()} on remote`);
      }
      return;
    }

    // Determine which resources to pull
    let toPull = remoteResources;

    if (!options.all) {
      // Find local resources to compare
      const localResources = await handler.findLocal();
      const localIds = new Set(localResources.map((r) => r.id));

      // Only pull resources that don't exist locally
      toPull = remoteResources.filter((r) => !localIds.has(r.id));
    }

    if (toPull.length === 0) {
      if (options.dryRun) {
        console.log(chalk.cyan(`${typeConfig.displayName}:`));
        console.log(chalk.dim("  All resources are up to date"));
        console.log();
      } else {
        spinner!.succeed(`All ${typeConfig.displayName.toLowerCase()} are up to date`);
      }
      return;
    }

    // Dry run mode - just show what would be pulled
    if (options.dryRun) {
      // Get local resources to show which would be new vs updated
      const localResources = await handler.findLocal();
      const localIds = new Set(localResources.map((r) => r.id));

      console.log(chalk.cyan(`${typeConfig.displayName}:`));
      console.log(`  ${toPull.length} resource(s) would be pulled:\n`);

      for (const resource of toPull) {
        const isNew = !localIds.has(resource.id);
        const symbol = isNew ? chalk.green("+") : chalk.yellow("~");
        const label = isNew ? chalk.dim(" (new)") : chalk.dim(" (update)");
        console.log(`  ${symbol} ${resource.id}${label}`);
      }
      console.log();
      return;
    }

    spinner!.text = `Pulling ${toPull.length} ${typeConfig.displayName.toLowerCase()}...`;

    let pulled = 0;
    let failed = 0;

    for (const resource of toPull) {
      try {
        const encrypted = await backend.pullResource(type, resource.id);
        const decrypted = await decrypt(encrypted);

        // For settings with merge strategy, merge with local
        if (typeConfig.strategy === "merge" && handler.merge) {
          const localResources = await handler.findLocal();
          if (localResources.length > 0) {
            const localContent = await handler.read(localResources[0]);
            const merged = await handler.merge(
              localContent,
              Buffer.from(decrypted, "utf-8")
            );
            await handler.write(resource.id, merged, resource.metadata);
          } else {
            await handler.write(resource.id, Buffer.from(decrypted, "utf-8"), resource.metadata);
          }
        } else {
          await handler.write(resource.id, Buffer.from(decrypted, "utf-8"), resource.metadata);
        }

        pulled++;
        spinner!.text = `Pulled ${pulled}/${toPull.length} ${typeConfig.displayName.toLowerCase()}...`;
      } catch (error) {
        failed++;
      }
    }

    if (failed > 0) {
      spinner!.warn(`Pulled ${pulled} ${typeConfig.displayName.toLowerCase()}, ${failed} failed`);
    } else {
      spinner!.succeed(`Pulled ${pulled} ${typeConfig.displayName.toLowerCase()}`);
    }
  } catch (error) {
    if (spinner) {
      spinner.fail(`Failed to pull ${typeConfig.displayName.toLowerCase()}: ${error}`);
    } else {
      console.log(chalk.red(`Failed to pull ${typeConfig.displayName.toLowerCase()}: ${error}`));
    }
    process.exit(1);
  }
}
