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

const CLAUDE_DIR = path.join(homedir(), ".claude");
const AGENTS_DIR = path.join(CLAUDE_DIR, "agents");

/**
 * Create a handler for custom agent definitions
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
          const id = path.basename(filePath, ".md");

          items.push({
            id,
            path: filePath,
            modifiedAt: stat.mtime,
          });
        }

        if (options?.modifiedSinceLastSync) {
          // TODO: Compare with last sync timestamp
          return items;
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
