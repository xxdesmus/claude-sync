#!/usr/bin/env node

/**
 * @fileoverview Main CLI entry point for claude-sync.
 * Provides commands for syncing Claude Code conversations, agents, and settings
 * across machines with end-to-end encryption.
 */

import { Command } from "commander";
import { createRequire } from "module";
import { init } from "./commands/init.js";
import { push } from "./commands/push.js";
import { pull } from "./commands/pull.js";
import { install } from "./commands/install.js";
import { status } from "./commands/status.js";
import { types } from "./commands/types.js";
import { ALL_RESOURCE_TYPES, isValidResourceType } from "./resources/index.js";

const require = createRequire(import.meta.url);
const { version } = require("../package.json");

const program = new Command();

program
  .name("claude-sync")
  .description(
    "Sync Claude Code conversations, agents, skills, and settings across machines. E2E encrypted, privacy-first."
  )
  .version(version);

program
  .command("init")
  .description("Initialize claude-sync with your storage backend")
  .option("--git <url>", "Use a Git repository for storage")
  .option("--s3 <bucket>", "Use AWS S3 bucket")
  .option("--gcs <bucket>", "Use Google Cloud Storage bucket")
  .option("--r2 <bucket>", "Use Cloudflare R2 bucket")
  .option("--region <region>", "AWS/S3 region")
  .option("--endpoint <url>", "Custom S3 endpoint URL")
  .action(init);

program
  .command("push [type]")
  .description(
    `Push local resources to cloud storage. Types: ${ALL_RESOURCE_TYPES.join(", ")}. Default: sessions`
  )
  .option("--session <id>", "Push a specific session (sessions type only)")
  .option(
    "--file <path>",
    "Push a specific transcript file (sessions type only)"
  )
  .option(
    "--all",
    "Push all resources (of the specified type, or all types if no type specified)"
  )
  .option("--dry-run", "Preview what would be pushed without actually pushing")
  .option("--verbose", "Show detailed error messages for failed resources")
  .action((type, options) => {
    // Validate type if provided
    if (type && !isValidResourceType(type)) {
      console.error(
        `Invalid resource type: ${type}. Valid types: ${ALL_RESOURCE_TYPES.join(", ")}`
      );
      process.exit(1);
    }
    push({ ...options, type: type || undefined });
  });

program
  .command("pull [type]")
  .description(
    `Pull resources from cloud storage. Types: ${ALL_RESOURCE_TYPES.join(", ")}. Default: sessions`
  )
  .option("--session <id>", "Pull a specific session (sessions type only)")
  .option(
    "--all",
    "Pull all resources (of the specified type, or all types if no type specified)"
  )
  .option("--dry-run", "Preview what would be pulled without actually pulling")
  .option(
    "--force",
    "Skip conflict prompts and always overwrite local with remote"
  )
  .option("--verbose", "Show detailed error messages for failed resources")
  .action((type, options) => {
    // Validate type if provided
    if (type && !isValidResourceType(type)) {
      console.error(
        `Invalid resource type: ${type}. Valid types: ${ALL_RESOURCE_TYPES.join(", ")}`
      );
      process.exit(1);
    }
    pull({ ...options, type: type || undefined });
  });

program
  .command("install")
  .description("Install Claude Code hooks for automatic sync")
  .option("--global", "Install hooks globally (~/.claude/settings.json)")
  .option("--project", "Install hooks for current project only")
  .action(install);

program
  .command("status")
  .description("Show sync status and configuration for all resource types")
  .action(status);

program
  .command("types")
  .description("List available resource types")
  .action(types);

program.parse();
