/**
 * @fileoverview Sessions resource handler.
 * Manages Claude Code conversation transcripts stored as JSONL files.
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
/** Directory containing project-specific session files. */
const PROJECTS_DIR = path.join(CLAUDE_DIR, "projects");

/**
 * Creates a handler for Claude Code session transcripts.
 * Sessions are stored as JSONL files organized by project.
 * @returns A ResourceHandler for managing session resources.
 */
export function createSessionsHandler(): ResourceHandler {
  return {
    config: RESOURCE_CONFIGS.sessions,

    async findLocal(options?: FindResourceOptions): Promise<ResourceItem[]> {
      const pattern = path.join(PROJECTS_DIR, "**", "*.jsonl");
      const files = await glob(pattern);

      const items: ResourceItem[] = [];

      for (const filePath of files) {
        const stat = await fs.stat(filePath);

        // Skip empty files - they have no content to sync
        if (stat.size === 0) {
          continue;
        }

        // Use full relative path as ID (without extension) to match S3 storage keys
        const relativePath = path.relative(PROJECTS_DIR, filePath);
        const id = relativePath.replace(/\.jsonl$/, "");

        // Extract project from path for metadata
        const project = path.dirname(relativePath);

        items.push({
          id,
          path: filePath,
          modifiedAt: stat.mtime,
          metadata: { project },
        });
      }

      if (options?.modifiedSinceLastSync) {
        const { loadSyncState } = await import("../../utils/syncState.js");
        const { hashContent } = await import("../../crypto/encrypt.js");
        const syncState = await loadSyncState();

        const filtered: ResourceItem[] = [];
        for (const item of items) {
          const storedHash = syncState.resources.sessions?.[item.id]?.hash;
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
    },

    async read(item: ResourceItem): Promise<Buffer> {
      if (!item.path) {
        throw new Error(`Session ${item.id} has no local path`);
      }
      return fs.readFile(item.path);
    },

    async write(
      id: string,
      content: Buffer,
      _metadata?: Record<string, unknown>
    ): Promise<string> {
      const localPath = await this.getLocalPath(id);
      await fs.writeFile(localPath, content);
      return localPath;
    },

    async getLocalPath(
      id: string,
      _metadata?: Record<string, unknown>
    ): Promise<string> {
      // ID contains full relative path (e.g., "unknown/agent-aprompt/suggestion-01e46f")
      const localPath = path.join(PROJECTS_DIR, `${id}.jsonl`);
      await fs.mkdir(path.dirname(localPath), { recursive: true });
      return localPath;
    },

    async getConflictPath(
      id: string,
      _metadata?: Record<string, unknown>
    ): Promise<string> {
      // ID contains full relative path
      const conflictPath = path.join(PROJECTS_DIR, `${id}.conflict.jsonl`);
      await fs.mkdir(path.dirname(conflictPath), { recursive: true });
      return conflictPath;
    },
  };
}
