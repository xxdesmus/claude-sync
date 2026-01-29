import fs from "fs/promises";
import path from "path";
import { homedir } from "os";
import type {
  ResourceHandler,
  ResourceItem,
  FindResourceOptions,
} from "../types.js";
import { RESOURCE_CONFIGS } from "../index.js";

const CLAUDE_DIR = path.join(homedir(), ".claude");
const SETTINGS_FILE = path.join(CLAUDE_DIR, "settings.json");
const SETTINGS_ID = "settings"; // Single resource ID

/**
 * Create a handler for Claude Code settings
 *
 * Settings use a merge strategy - when pulling, local and remote settings
 * are merged rather than replaced. This allows for machine-specific settings
 * while syncing shared preferences like enabledPlugins.
 */
export function createSettingsHandler(): ResourceHandler {
  return {
    config: RESOURCE_CONFIGS.settings,

    async findLocal(_options?: FindResourceOptions): Promise<ResourceItem[]> {
      try {
        const stat = await fs.stat(SETTINGS_FILE);
        return [
          {
            id: SETTINGS_ID,
            path: SETTINGS_FILE,
            modifiedAt: stat.mtime,
          },
        ];
      } catch {
        // Settings file might not exist
        return [];
      }
    },

    async read(item: ResourceItem): Promise<Buffer> {
      if (!item.path) {
        throw new Error("Settings has no local path");
      }
      return fs.readFile(item.path);
    },

    async write(
      id: string,
      content: Buffer,
      _metadata?: Record<string, unknown>
    ): Promise<string> {
      const localPath = await this.getLocalPath(id);
      await fs.mkdir(path.dirname(localPath), { recursive: true });
      await fs.writeFile(localPath, content);
      return localPath;
    },

    async getLocalPath(
      _id: string,
      _metadata?: Record<string, unknown>
    ): Promise<string> {
      return SETTINGS_FILE;
    },

    /**
     * Merge local and remote settings
     *
     * Strategy:
     * - Arrays (like enabledPlugins): union of both
     * - Objects: deep merge, local takes precedence for conflicts
     * - Primitives: local takes precedence
     */
    async merge(local: Buffer, remote: Buffer): Promise<Buffer> {
      let localObj: Record<string, unknown>;
      let remoteObj: Record<string, unknown>;

      try {
        localObj = JSON.parse(local.toString("utf-8"));
      } catch {
        localObj = {};
      }

      try {
        remoteObj = JSON.parse(remote.toString("utf-8"));
      } catch {
        remoteObj = {};
      }

      const merged = deepMerge(remoteObj, localObj);
      return Buffer.from(JSON.stringify(merged, null, 2), "utf-8");
    },
  };
}

/**
 * Deep merge two objects, with right object taking precedence
 */
function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...target };

  for (const key of Object.keys(source)) {
    const sourceVal = source[key];
    const targetVal = target[key];

    if (Array.isArray(sourceVal) && Array.isArray(targetVal)) {
      // Union arrays, removing duplicates
      result[key] = [...new Set([...targetVal, ...sourceVal])];
    } else if (
      isObject(sourceVal) &&
      isObject(targetVal)
    ) {
      // Recursively merge objects
      result[key] = deepMerge(
        targetVal as Record<string, unknown>,
        sourceVal as Record<string, unknown>
      );
    } else {
      // Source (local) takes precedence
      result[key] = sourceVal;
    }
  }

  return result;
}

function isObject(val: unknown): val is Record<string, unknown> {
  return val !== null && typeof val === "object" && !Array.isArray(val);
}
