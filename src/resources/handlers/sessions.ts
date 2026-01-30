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
 * Normalizes a session ID to canonical format: project/basename.
 * Handles both subdirectory structure and flat files with underscores.
 * @param basename - The filename without extension.
 * @param dirname - The directory relative to PROJECTS_DIR (may be "." for flat files).
 * @returns Normalized ID in project/basename format.
 */
function normalizeSessionId(basename: string, dirname: string): string {
  if (dirname && dirname !== "." && dirname !== "") {
    // Subdirectory structure: ~/.claude/projects/agent-aprompt/suggestion-xxx.jsonl
    // ID = agent-aprompt/suggestion-xxx
    return `${dirname}/${basename}`;
  }

  // Flat file - check for underscore pattern like agent-aprompt_suggestion-xxx
  // This happens when Claude Code stores files differently on some machines
  const underscoreMatch = basename.match(/^([^_]+)_(.+)$/);
  if (underscoreMatch) {
    // Convert agent-aprompt_suggestion-xxx to agent-aprompt/suggestion-xxx
    return `${underscoreMatch[1]}/${underscoreMatch[2]}`;
  }

  // No project prefix found - use "unknown" as fallback
  return `unknown/${basename}`;
}

/**
 * Extracts project and basename from a normalized session ID.
 * @param id - Normalized ID in project/basename format.
 * @returns Object with project and basename components.
 */
function parseSessionId(id: string): { project: string; basename: string } {
  const slashIndex = id.indexOf("/");
  if (slashIndex === -1) {
    return { project: "unknown", basename: id };
  }
  return {
    project: id.substring(0, slashIndex),
    basename: id.substring(slashIndex + 1),
  };
}

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

        const basename = path.basename(filePath, ".jsonl");
        const relativePath = path.relative(PROJECTS_DIR, filePath);
        const dirname = path.dirname(relativePath);

        // Normalize ID to always include project prefix
        const id = normalizeSessionId(basename, dirname);
        const { project } = parseSessionId(id);

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
      await fs.mkdir(path.dirname(localPath), { recursive: true });
      await fs.writeFile(localPath, content);
      return localPath;
    },

    async getLocalPath(
      id: string,
      _metadata?: Record<string, unknown>
    ): Promise<string> {
      // ID is in normalized format: project/basename
      // Write to subdirectory structure: ~/.claude/projects/project/basename.jsonl
      const { project, basename } = parseSessionId(id);
      const projectDir = path.join(PROJECTS_DIR, project);
      await fs.mkdir(projectDir, { recursive: true });
      return path.join(projectDir, `${basename}.jsonl`);
    },

    async getConflictPath(
      id: string,
      _metadata?: Record<string, unknown>
    ): Promise<string> {
      const { project, basename } = parseSessionId(id);
      const projectDir = path.join(PROJECTS_DIR, project);
      await fs.mkdir(projectDir, { recursive: true });
      return path.join(projectDir, `${basename}.conflict.jsonl`);
    },
  };
}
