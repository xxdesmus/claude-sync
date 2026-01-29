/**
 * @fileoverview Push command implementation.
 * Handles pushing local resources (sessions, agents, settings) to the remote backend.
 */

import ora from "ora";
import chalk from "chalk";
import { encrypt } from "../crypto/encrypt.js";
import { getBackend } from "../backends/index.js";
import { loadConfig } from "../utils/config.js";
import {
  getResourceHandler,
  ALL_RESOURCE_TYPES,
  RESOURCE_CONFIGS,
  type ResourceType,
  type ResourceItem,
} from "../resources/index.js";

/** Number of resources to encrypt in parallel per batch. */
const ENCRYPT_BATCH_SIZE = 20;

/**
 * Options for the push command.
 */
interface PushOptions {
  type?: ResourceType;
  session?: string;
  file?: string;
  all?: boolean;
  dryRun?: boolean;
}

/**
 * Pushes local resources to the remote storage backend.
 * Encrypts resources before uploading and supports batch operations.
 * @param options - Push configuration including resource type, specific session, or all flag.
 * @returns A promise that resolves when the push operation is complete.
 */
export async function push(options: PushOptions): Promise<void> {
  const config = await loadConfig();

  // For dry-run, we only need to show local resources - no backend required
  if (!options.dryRun && !config?.initialized) {
    console.log(
      chalk.red(
        "Error: claude-sync not initialized. Run `claude-sync init` first."
      )
    );
    process.exit(1);
  }

  if (options.dryRun) {
    console.log(chalk.bold("\nDry Run - Preview of resources to push:\n"));
  }

  const backend = options.dryRun ? null : await getBackend(config!);

  // Determine which types to push
  const typesToPush: ResourceType[] = options.type
    ? [options.type]
    : options.all
      ? ALL_RESOURCE_TYPES
      : ["sessions"]; // Default to sessions for backwards compatibility

  // Handle legacy session-specific options
  if (options.session || options.file) {
    if (options.type && options.type !== "sessions") {
      console.log(
        chalk.red(
          "Error: --session and --file options are only valid for sessions type"
        )
      );
      process.exit(1);
    }
    await pushSpecificSession(options, backend);
    return;
  }

  // Push each resource type
  for (const resourceType of typesToPush) {
    await pushResourceType(resourceType, options, backend);
  }

  if (options.dryRun) {
    console.log(
      chalk.dim("\nRun without --dry-run to actually push these resources.")
    );
  }
}

async function pushSpecificSession(
  options: PushOptions,
  backend: Awaited<ReturnType<typeof getBackend>> | null
): Promise<void> {
  const handler = getResourceHandler("sessions");

  let resources: ResourceItem[];

  if (options.file) {
    // Push specific file (used by hooks)
    resources = [{ id: options.session || "unknown", path: options.file }];
  } else if (options.session) {
    // Push specific session by ID
    const allResources = await handler.findLocal();
    const resource = allResources.find((r) => r.id === options.session);
    if (!resource) {
      console.log(chalk.red(`Session ${options.session} not found`));
      process.exit(1);
    }
    resources = [resource];
  } else {
    return;
  }

  if (options.dryRun) {
    console.log(chalk.cyan("Sessions:"));
    for (const resource of resources) {
      console.log(`  ${chalk.green("+")} ${resource.id}`);
      if (resource.path) {
        console.log(chalk.dim(`      ${resource.path}`));
      }
    }
    return;
  }

  const spinner = ora("Pushing session...").start();
  try {
    const data = await handler.read(resources[0]);
    const encrypted = await encrypt(data.toString("utf-8"));
    await backend!.pushResource(
      "sessions",
      resources[0].id,
      encrypted,
      resources[0].metadata
    );
    spinner.succeed("Pushed 1 session");
  } catch (error) {
    spinner.fail(`Failed to push session: ${error}`);
  }
}

async function pushResourceType(
  type: ResourceType,
  options: PushOptions,
  backend: Awaited<ReturnType<typeof getBackend>> | null
): Promise<void> {
  const handler = getResourceHandler(type);
  const typeConfig = RESOURCE_CONFIGS[type];

  // Find resources to push
  const resources = options.all
    ? await handler.findLocal()
    : await handler.findLocal({ modifiedSinceLastSync: true });

  if (resources.length === 0) {
    if (options.dryRun) {
      console.log(chalk.cyan(`${typeConfig.displayName}:`));
      console.log(chalk.dim("  No resources to push"));
      console.log();
    } else {
      console.log(
        chalk.dim(`No ${typeConfig.displayName.toLowerCase()} to push`)
      );
    }
    return;
  }

  // Dry run mode - just show what would be pushed
  if (options.dryRun) {
    console.log(chalk.cyan(`${typeConfig.displayName}:`));
    console.log(`  ${resources.length} resource(s) would be pushed:\n`);
    for (const resource of resources) {
      console.log(`  ${chalk.green("+")} ${resource.id}`);
      if (resource.path) {
        console.log(chalk.dim(`      ${resource.path}`));
      }
      if (resource.metadata && Object.keys(resource.metadata).length > 0) {
        const metaStr = Object.entries(resource.metadata)
          .map(([k, v]) => `${k}=${v}`)
          .join(", ");
        console.log(chalk.dim(`      metadata: ${metaStr}`));
      }
    }
    console.log();
    return;
  }

  // For single resource, use simple push
  if (resources.length === 1) {
    const spinner = ora(
      `Pushing ${typeConfig.displayName.toLowerCase()}...`
    ).start();
    try {
      const data = await handler.read(resources[0]);
      const encrypted = await encrypt(data.toString("utf-8"));
      await backend!.pushResource(
        type,
        resources[0].id,
        encrypted,
        resources[0].metadata
      );
      spinner.succeed(
        `Pushed 1 ${typeConfig.displayName.toLowerCase().replace(/s$/, "")}`
      );
    } catch (error) {
      spinner.fail(
        `Failed to push ${typeConfig.displayName.toLowerCase()}: ${error}`
      );
    }
    return;
  }

  // For multiple resources, use batch mode
  const spinner = ora(
    `Encrypting ${resources.length} ${typeConfig.displayName.toLowerCase()}...`
  ).start();

  // Step 1: Read and encrypt all resources in parallel batches
  const encryptedResources: Array<{
    id: string;
    data: Buffer;
    metadata?: Record<string, unknown>;
  }> = [];
  let encryptFailed = 0;

  for (let i = 0; i < resources.length; i += ENCRYPT_BATCH_SIZE) {
    const batch = resources.slice(i, i + ENCRYPT_BATCH_SIZE);

    const results = await Promise.allSettled(
      batch.map(async (resource) => {
        const data = await handler.read(resource);
        const encrypted = await encrypt(data.toString("utf-8"));
        return {
          id: resource.id,
          data: encrypted,
          metadata: resource.metadata,
        };
      })
    );

    for (const result of results) {
      if (result.status === "fulfilled") {
        encryptedResources.push(result.value);
      } else {
        encryptFailed++;
      }
    }

    spinner.text = `Encrypting... ${encryptedResources.length + encryptFailed}/${resources.length}`;
  }

  if (encryptFailed > 0) {
    spinner.text = `Encrypted ${encryptedResources.length} ${typeConfig.displayName.toLowerCase()} (${encryptFailed} failed)`;
  }

  // Step 2: Push all encrypted resources in batch
  spinner.text = `Writing ${encryptedResources.length} ${typeConfig.displayName.toLowerCase()}...`;

  const { pushed, failed } = await backend!.pushResourceBatch(
    type,
    encryptedResources,
    (done, total) => {
      spinner.text = `Writing... ${done}/${total}`;
    }
  );

  const totalFailed = failed + encryptFailed;

  if (totalFailed > 0) {
    spinner.warn(
      `Pushed ${pushed} ${typeConfig.displayName.toLowerCase()}, ${totalFailed} failed`
    );
  } else {
    spinner.succeed(`Pushed ${pushed} ${typeConfig.displayName.toLowerCase()}`);
  }
}
