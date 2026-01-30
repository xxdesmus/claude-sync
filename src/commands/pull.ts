/**
 * @fileoverview Pull command implementation.
 * Handles pulling remote resources (sessions, agents, settings) from the backend.
 */

import fs from "fs/promises";
import ora from "ora";
import chalk from "chalk";
import inquirer from "inquirer";
import { decrypt, hashContent } from "../crypto/encrypt.js";
import { getBackend } from "../backends/index.js";
import { loadConfig } from "../utils/config.js";
import { updateResourceHashBatch } from "../utils/syncState.js";
import {
  getResourceHandler,
  ALL_RESOURCE_TYPES,
  RESOURCE_CONFIGS,
  type ResourceType,
} from "../resources/index.js";
import type { ResourceItem, RemoteResource } from "../resources/types.js";

/**
 * Options for the pull command.
 */
interface PullOptions {
  type?: ResourceType;
  session?: string;
  all?: boolean;
  dryRun?: boolean;
  force?: boolean;
  verbose?: boolean;
}

/**
 * Resolution choice for a conflict.
 */
type ConflictResolution = "local" | "remote" | "both";

/**
 * Information about a detected conflict.
 */
interface Conflict {
  id: string;
  type: ResourceType;
  localPath: string;
  localModified?: Date;
  metadata?: Record<string, unknown>;
}

/**
 * Pulls resources from the remote storage backend to the local machine.
 * Decrypts resources after downloading and supports merge strategies for settings.
 * @param options - Pull configuration including resource type, specific session, or all flag.
 * @returns A promise that resolves when the pull operation is complete.
 */
export async function pull(options: PullOptions): Promise<void> {
  const config = await loadConfig();

  if (!config?.initialized) {
    console.log(
      chalk.red(
        "Error: claude-sync not initialized. Run `claude-sync init` first."
      )
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
    console.log(
      chalk.dim("\nRun without --dry-run to actually pull these resources.")
    );
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
    const decryptedBuffer = Buffer.from(decrypted, "utf-8");

    await handler.write(sessionId, decryptedBuffer, resource.metadata);

    // Update sync state
    await updateResourceHashBatch([
      { type: "sessions", id: sessionId, hash: hashContent(decryptedBuffer) },
    ]);

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
    : ora(
        `Fetching ${typeConfig.displayName.toLowerCase()} from remote...`
      ).start();

  try {
    // Get list of remote resources
    const remoteResources = await backend.listResources(type);

    if (remoteResources.length === 0) {
      if (options.dryRun) {
        console.log(chalk.cyan(`${typeConfig.displayName}:`));
        console.log(chalk.dim("  No resources on remote"));
        console.log();
      } else {
        spinner!.succeed(
          `No ${typeConfig.displayName.toLowerCase()} on remote`
        );
      }
      return;
    }

    // Get local resources
    const localResources = await handler.findLocal();
    const localById = new Map<string, ResourceItem>();
    const localByBasename = new Map<string, ResourceItem>();
    for (const r of localResources) {
      localById.set(r.id, r);
      // Also index by basename for matching remote IDs that include path prefixes
      const basename = r.id.includes("/") ? r.id.split("/").pop()! : r.id;
      localByBasename.set(basename, r);
    }

    // Helper to find local resource by remote ID (tries full ID, then basename)
    const findLocalResource = (remoteId: string): ResourceItem | undefined => {
      // First try exact match
      const local = localById.get(remoteId);
      if (local) return local;

      // Try matching by basename (handles remote IDs with path prefixes)
      const remoteBasename = remoteId.includes("/")
        ? remoteId.split("/").pop()!
        : remoteId;
      return localByBasename.get(remoteBasename);
    };

    // Determine which resources to pull and detect conflicts
    let toPull: RemoteResource[] = [];
    const conflicts: Conflict[] = [];

    if (options.all) {
      // Pull all - check for conflicts on resources that exist locally
      for (const remote of remoteResources) {
        const local = findLocalResource(remote.id);
        if (local && local.path) {
          // Check for conflict by comparing content hashes
          const hasConflict = await detectConflict(
            type,
            remote,
            local,
            handler,
            backend
          );
          if (hasConflict) {
            conflicts.push({
              id: remote.id,
              type,
              localPath: local.path,
              localModified: local.modifiedAt,
              metadata: remote.metadata,
            });
          }
          // If no conflict (content identical), skip - don't re-download to a different path
        } else {
          toPull.push(remote);
        }
      }
    } else {
      // Only pull resources that don't exist locally
      toPull = remoteResources.filter((r) => !findLocalResource(r.id));
    }

    // Handle dry run
    if (options.dryRun) {
      console.log(chalk.cyan(`${typeConfig.displayName}:`));

      if (toPull.length === 0 && conflicts.length === 0) {
        console.log(chalk.dim("  All resources are up to date"));
        console.log();
        return;
      }

      if (toPull.length > 0) {
        console.log(`  ${toPull.length} resource(s) would be pulled:\n`);
        for (const resource of toPull) {
          const isNew = !localById.has(resource.id);
          const symbol = isNew ? chalk.green("+") : chalk.yellow("~");
          const label = isNew ? chalk.dim(" (new)") : chalk.dim(" (update)");
          console.log(`  ${symbol} ${resource.id}${label}`);
        }
      }

      if (conflicts.length > 0) {
        console.log(
          `\n  ${chalk.yellow("⚠")} ${conflicts.length} conflict(s) detected:\n`
        );
        for (const conflict of conflicts) {
          console.log(`  ${chalk.red("!")} ${conflict.id}`);
          if (conflict.localModified) {
            console.log(
              chalk.dim(
                `      Local modified: ${conflict.localModified.toISOString()}`
              )
            );
          }
        }
      }

      console.log();
      return;
    }

    // Handle conflicts
    let resolvedConflicts = 0;
    let keptLocal = 0;
    let keptRemote = 0;
    let keptBoth = 0;

    if (conflicts.length > 0 && !options.force) {
      spinner!.stop();

      console.log(
        chalk.yellow(
          `\n⚠️  ${conflicts.length} conflict(s) detected for ${typeConfig.displayName.toLowerCase()}\n`
        )
      );

      for (const conflict of conflicts) {
        const resolution = await promptConflictResolution(conflict);
        resolvedConflicts++;

        switch (resolution) {
          case "local":
            keptLocal++;
            // Don't pull - keep local
            break;
          case "remote": {
            keptRemote++;
            // Add to pull list to overwrite local
            const remoteResource = remoteResources.find(
              (r) => r.id === conflict.id
            );
            if (remoteResource) {
              toPull.push(remoteResource);
            }
            break;
          }
          case "both":
            keptBoth++;
            // Pull remote as conflict file
            await pullAsConflict(type, conflict, handler, backend);
            break;
        }
      }

      spinner!.start();
    } else if (conflicts.length > 0 && options.force) {
      // Force mode - add all conflicts to pull list (overwrite local)
      for (const conflict of conflicts) {
        const remoteResource = remoteResources.find(
          (r) => r.id === conflict.id
        );
        if (remoteResource) {
          toPull.push(remoteResource);
          keptRemote++;
        }
      }
    }

    if (toPull.length === 0) {
      spinner!.succeed(
        `All ${typeConfig.displayName.toLowerCase()} are up to date`
      );
      return;
    }

    spinner!.text = `Pulling ${toPull.length} ${typeConfig.displayName.toLowerCase()}...`;

    let pulled = 0;
    let failed = 0;
    const pullErrors: Array<{ id: string; error: string }> = [];
    const hashUpdates: Array<{ type: ResourceType; id: string; hash: string }> =
      [];

    for (const resource of toPull) {
      try {
        const encrypted = await backend.pullResource(type, resource.id);
        const decrypted = await decrypt(encrypted);
        const decryptedBuffer = Buffer.from(decrypted, "utf-8");

        // For settings with merge strategy, merge with local
        if (typeConfig.strategy === "merge" && handler.merge) {
          const localResources = await handler.findLocal();
          if (localResources.length > 0) {
            const localContent = await handler.read(localResources[0]);
            const merged = await handler.merge(localContent, decryptedBuffer);
            await handler.write(resource.id, merged, resource.metadata);
            hashUpdates.push({
              type,
              id: resource.id,
              hash: hashContent(merged),
            });
          } else {
            await handler.write(
              resource.id,
              decryptedBuffer,
              resource.metadata
            );
            hashUpdates.push({
              type,
              id: resource.id,
              hash: hashContent(decryptedBuffer),
            });
          }
        } else {
          await handler.write(resource.id, decryptedBuffer, resource.metadata);
          hashUpdates.push({
            type,
            id: resource.id,
            hash: hashContent(decryptedBuffer),
          });
        }

        pulled++;
        spinner!.text = `Pulled ${pulled}/${toPull.length} ${typeConfig.displayName.toLowerCase()}...`;
      } catch (error) {
        failed++;
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        pullErrors.push({ id: resource.id, error: errorMessage });
      }
    }

    // Update sync state for all pulled resources
    if (hashUpdates.length > 0) {
      await updateResourceHashBatch(hashUpdates);
    }

    // Build summary message
    let message = `Pulled ${pulled} ${typeConfig.displayName.toLowerCase()}`;
    if (failed > 0) {
      message += `, ${failed} failed`;
    }
    if (resolvedConflicts > 0) {
      const resolutions: string[] = [];
      if (keptLocal > 0) resolutions.push(`${keptLocal} kept local`);
      if (keptRemote > 0) resolutions.push(`${keptRemote} overwritten`);
      if (keptBoth > 0) resolutions.push(`${keptBoth} saved as .conflict`);
      message += ` (${resolutions.join(", ")})`;
    }

    if (failed > 0) {
      spinner!.warn(message);

      // Display detailed errors when verbose flag is set
      if (options.verbose && pullErrors.length > 0) {
        console.log(chalk.red("\nFailed resources:"));
        for (const { id, error } of pullErrors) {
          console.log(chalk.red(`  ${id}: ${error}`));
        }
      }
    } else {
      spinner!.succeed(message);
    }
  } catch (error) {
    if (spinner) {
      spinner.fail(
        `Failed to pull ${typeConfig.displayName.toLowerCase()}: ${error}`
      );
    } else {
      console.log(
        chalk.red(
          `Failed to pull ${typeConfig.displayName.toLowerCase()}: ${error}`
        )
      );
    }
    process.exit(1);
  }
}

/**
 * Detects if there is a conflict between local and remote versions of a resource.
 * A conflict exists when both versions have different content.
 */
async function detectConflict(
  type: ResourceType,
  remote: RemoteResource,
  local: ResourceItem,
  handler: ReturnType<typeof getResourceHandler>,
  backend: Awaited<ReturnType<typeof getBackend>>
): Promise<boolean> {
  try {
    // Read local content and compute hash
    const localContent = await handler.read(local);
    const localHash = hashContent(localContent);

    // Pull and decrypt remote content to compute hash
    const encrypted = await backend.pullResource(type, remote.id);
    const decrypted = await decrypt(encrypted);
    const remoteHash = hashContent(Buffer.from(decrypted, "utf-8"));

    // Conflict if hashes differ
    return localHash !== remoteHash;
  } catch {
    // If we can't compare, assume no conflict
    return false;
  }
}

/**
 * Prompts the user to resolve a conflict.
 */
async function promptConflictResolution(
  conflict: Conflict
): Promise<ConflictResolution> {
  console.log(chalk.yellow(`\nConflict: ${conflict.id}`));
  if (conflict.localModified) {
    console.log(
      chalk.dim(`  Local modified: ${conflict.localModified.toISOString()}`)
    );
  }
  console.log(chalk.dim(`  Path: ${conflict.localPath}`));

  const { resolution } = await inquirer.prompt<{
    resolution: ConflictResolution;
  }>([
    {
      type: "list",
      name: "resolution",
      message: "How do you want to resolve this conflict?",
      choices: [
        {
          name: "Keep local (skip remote)",
          value: "local",
        },
        {
          name: "Keep remote (overwrite local)",
          value: "remote",
        },
        {
          name: "Keep both (save remote as .conflict file)",
          value: "both",
        },
      ],
    },
  ]);

  return resolution;
}

/**
 * Pulls the remote version and saves it as a conflict file.
 */
async function pullAsConflict(
  type: ResourceType,
  conflict: Conflict,
  handler: ReturnType<typeof getResourceHandler>,
  backend: Awaited<ReturnType<typeof getBackend>>
): Promise<void> {
  const encrypted = await backend.pullResource(type, conflict.id);
  const decrypted = await decrypt(encrypted);
  const decryptedBuffer = Buffer.from(decrypted, "utf-8");

  // Get conflict path if handler supports it, otherwise append .conflict
  let conflictPath: string;
  if (handler.getConflictPath) {
    conflictPath = await handler.getConflictPath(
      conflict.id,
      conflict.metadata
    );
  } else {
    conflictPath = conflict.localPath.replace(/(\.\w+)?$/, ".conflict$1");
  }

  await fs.writeFile(conflictPath, decryptedBuffer);
  console.log(chalk.dim(`  Saved remote version to: ${conflictPath}`));
}
