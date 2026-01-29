import chalk from "chalk";
import { ALL_RESOURCE_TYPES, RESOURCE_CONFIGS } from "../resources/index.js";

export async function types(): Promise<void> {
  console.log(chalk.bold("\nAvailable Resource Types\n"));

  for (const type of ALL_RESOURCE_TYPES) {
    const config = RESOURCE_CONFIGS[type];
    console.log(chalk.cyan(type));
    console.log(`  ${config.description}`);
    console.log(chalk.dim(`  Strategy: ${config.strategy}`));
    console.log();
  }

  console.log(chalk.bold("Usage:"));
  console.log("  claude-sync push [type]    Push resources of specified type");
  console.log("  claude-sync pull [type]    Pull resources of specified type");
  console.log("  claude-sync push --all     Push all resource types");
  console.log("  claude-sync pull --all     Pull all resource types");
  console.log();
}
