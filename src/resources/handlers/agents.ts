/**
 * @fileoverview Agents resource handler.
 * Manages custom Claude agent definitions stored as Markdown files.
 */

import fs from "fs/promises";
import path from "path";
import { homedir } from "os";
import { glob } from "glob";
import type {
  ResourceHandler,
  ResourceItem,
  FindResourceOptions,
} from "../types.js";
import { RESOURCE_CONFIGS } from "../index.js";

/** Base Claude configuration directory. */
const CLAUDE_DIR = path.join(homedir(), ".claude");
/** Directory containing custom agent definition files. */
const AGENTS_DIR = path.join(CLAUDE_DIR, "agents");

/**
 * Creates a handler for custom agent definitions.
 * Agents are stored as Markdown files in the agents directory.
 * @returns A ResourceHandler for managing agent resources.
 */
export function createAgentsHandler(): ResourceHandler {
  return {
    config: RESOURCE_CONFIGS.agents,

    async findLocal(options?: FindResourceOptions): Promise<ResourceItem[]> {
      const pattern = path.join(AGENTS_DIR, "*.md");

      try {
        const files = await glob(pattern);
        const items: ResourceItem[] = [];

        for (const filePath of files) {
          const stat = await fs.stat(filePath);

          // Skip empty files - they have no content to sync
          if (stat.size === 0) {
            continue;
          }

          const id = path.basename(filePath, ".md");

          items.push({
            id,
            path: filePath,
            modifiedAt: stat.mtime,
          });
        }

        if (options?.modifiedSinceLastSync) {
          const { loadSyncState } = await import("../../utils/syncState.js");
          const { hashContent } = await import("../../crypto/encrypt.js");
          const syncState = await loadSyncState();

          const filtered: ResourceItem[] = [];
          for (const item of items) {
            const storedHash = syncState.resources.agents?.[item.id]?.hash;
            if (!storedHash) {
              // Never synced - include it
              filtered.push(item);
            } else {
              // Compare current content hash with stored hash
              const content = await fs.readFile(item.path!);
              const currentHash = hashContent(content);
              if (currentHash !== storedHash) {
                filtered.push(item);
              }
            }
          }
          return filtered;
        }

        return items;
      } catch {
        // Agents directory might not exist
        return [];
      }
    },

    async read(item: ResourceItem): Promise<Buffer> {
      if (!item.path) {
        throw new Error(`Agent ${item.id} has no local path`);
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
      id: string,
      _metadata?: Record<string, unknown>
    ): Promise<string> {
      await fs.mkdir(AGENTS_DIR, { recursive: true });
      return path.join(AGENTS_DIR, `${id}.md`);
    },
  };
}
