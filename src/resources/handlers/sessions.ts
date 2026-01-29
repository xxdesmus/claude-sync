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
        const id = path.basename(filePath, ".jsonl");

        // Extract project from path for metadata
        const relativePath = path.relative(PROJECTS_DIR, filePath);
        const project = path.dirname(relativePath);

        items.push({
          id,
          path: filePath,
          modifiedAt: stat.mtime,
          metadata: { project },
        });
      }

      if (options?.modifiedSinceLastSync) {
        // TODO: Compare with last sync timestamp
        // For now, return all
        return items;
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
      metadata?: Record<string, unknown>
    ): Promise<string> {
      const _project = (metadata?.project as string) || "unknown";
      const localPath = await this.getLocalPath(id, metadata);
      await fs.mkdir(path.dirname(localPath), { recursive: true });
      await fs.writeFile(localPath, content);
      return localPath;
    },

    async getLocalPath(
      id: string,
      metadata?: Record<string, unknown>
    ): Promise<string> {
      const project = (metadata?.project as string) || "unknown";
      const projectDir = path.join(PROJECTS_DIR, project);
      await fs.mkdir(projectDir, { recursive: true });
      return path.join(projectDir, `${id}.jsonl`);
    },

    async getConflictPath(
      id: string,
      metadata?: Record<string, unknown>
    ): Promise<string> {
      const project = (metadata?.project as string) || "unknown";
      const projectDir = path.join(PROJECTS_DIR, project);
      await fs.mkdir(projectDir, { recursive: true });
      return path.join(projectDir, `${id}.conflict.jsonl`);
    },
  };
}
