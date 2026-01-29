/**
 * @fileoverview Configuration utilities for claude-sync.
 * Handles loading and saving the main configuration file.
 */

import fs from "fs/promises";
import path from "path";
import { homedir } from "os";
import type { Config } from "../backends/index.js";

/** Directory for claude-sync configuration and data. */
const CONFIG_DIR = path.join(homedir(), ".claude-sync");
/** Path to the main configuration file. */
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

/**
 * Saves the configuration to disk.
 * Creates the configuration directory if it does not exist.
 * @param config - The configuration object to save.
 * @returns A promise that resolves when the config is saved.
 */
export async function saveConfig(config: Config): Promise<void> {
  await fs.mkdir(CONFIG_DIR, { recursive: true });
  await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2));
}

/**
 * Loads the configuration from disk.
 * @returns The configuration object, or null if not found or invalid.
 */
export async function loadConfig(): Promise<Config | null> {
  try {
    const data = await fs.readFile(CONFIG_FILE, "utf-8");
    return JSON.parse(data);
  } catch {
    return null;
  }
}
