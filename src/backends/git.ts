/**
 * @fileoverview Git backend implementation.
 * Stores encrypted resources in a Git repository for sync across machines.
 */

import simpleGit, { SimpleGit } from "simple-git";
import fs from "fs/promises";
import path from "path";
import { homedir } from "os";
import { glob } from "glob";
import type { Backend, RemoteSession } from "./index.js";
import type { ResourceType, RemoteResource } from "../resources/types.js";
import { RESOURCE_CONFIGS } from "../resources/index.js";
import { assertEncrypted } from "../crypto/encrypt.js";

/** Local directory where the Git repository is cloned. */
const SYNC_DIR = path.join(homedir(), ".claude-sync", "repo");

/**
 * Initializes the Git backend by cloning or configuring the repository.
 * Creates necessary directories for storing different resource types.
 * @param url - The Git repository URL (should be a private repository).
 * @returns A promise that resolves when initialization is complete.
 */
export async function initGitBackend(url: string): Promise<void> {
  await fs.mkdir(SYNC_DIR, { recursive: true });

  const git: SimpleGit = simpleGit(SYNC_DIR);

  // Check if already initialized
  const isRepo = await git.checkIsRepo().catch(() => false);

  if (isRepo) {
    // Verify remote matches
    const remotes = await git.getRemotes(true);
    const origin = remotes.find((r) => r.name === "origin");
    if (origin?.refs.fetch !== url) {
      await git.remote(["set-url", "origin", url]);
    }
    await git.pull("origin", "main").catch(() => {
      // Might be empty repo, that's fine
    });
  } else {
    // Clone or init
    try {
      await simpleGit().clone(url, SYNC_DIR);
    } catch {
      // Empty repo, init locally
      await git.init();
      await git.addRemote("origin", url);
    }
  }

  // Create directories for all resource types
  await fs.mkdir(path.join(SYNC_DIR, "sessions"), { recursive: true });
  await fs.mkdir(path.join(SYNC_DIR, "agents"), { recursive: true });
  await fs.mkdir(path.join(SYNC_DIR, "settings"), { recursive: true });
}

/** Number of files to write in parallel per batch. */
const BATCH_SIZE = 50;

/**
 * Computes the local storage path for a resource within the Git repository.
 * @param type - The resource type (sessions, agents, settings).
 * @param id - The resource identifier.
 * @returns The absolute file path for the encrypted resource file.
 */
function getResourcePath(type: ResourceType, id: string): string {
  const config = RESOURCE_CONFIGS[type];
  const safeId = id.replace(/\//g, "_");
  return path.join(SYNC_DIR, config.storagePrefix, `${safeId}.enc`);
}

/**
 * Extracts the resource ID from an encrypted filename.
 * Reverses the transformation done in getResourcePath.
 * @param filename - The filename including .enc extension.
 * @returns The original resource ID.
 */
function parseResourceId(filename: string): string {
  // Remove .enc extension and convert _ back to /
  return filename.replace(".enc", "").replace(/_/g, "/");
}

/**
 * Creates a Git-based backend for storing encrypted resources.
 * Uses a local Git repository that syncs with a remote for cross-machine access.
 * @returns A Backend implementation using Git for storage.
 */
export function createGitBackend(): Backend {
  const git: SimpleGit = simpleGit(SYNC_DIR);

  return {
    // Legacy session-only methods (for backwards compatibility)
    async push(sessionId: string, encryptedData: Buffer): Promise<void> {
      return this.pushResource("sessions", sessionId, encryptedData);
    },

    async pushBatch(
      sessions: Array<{ id: string; data: Buffer }>,
      onProgress?: (done: number, total: number) => void
    ): Promise<{ pushed: number; failed: number }> {
      return this.pushResourceBatch("sessions", sessions, onProgress);
    },

    async pull(sessionId: string): Promise<Buffer> {
      return this.pullResource("sessions", sessionId);
    },

    async list(): Promise<RemoteSession[]> {
      const resources = await this.listResources("sessions");
      return resources.map((r) => ({
        id: r.id,
        project: (r.metadata?.project as string) || "unknown",
        existsLocally: r.existsLocally,
      }));
    },

    async delete(sessionId: string): Promise<void> {
      return this.deleteResource("sessions", sessionId);
    },

    // Resource-aware methods
    async pushResource(
      type: ResourceType,
      id: string,
      encryptedData: Buffer,
      _metadata?: Record<string, unknown>
    ): Promise<void> {
      // Verify data is encrypted before writing
      assertEncrypted(encryptedData, `${type} ${id}`);

      const resourcePath = getResourcePath(type, id);

      // Ensure directory exists
      await fs.mkdir(path.dirname(resourcePath), { recursive: true });

      // Write encrypted data
      await fs.writeFile(resourcePath, encryptedData);

      // Commit and push
      await git.add(resourcePath);
      await git.commit(`sync ${type}: ${id}`, { "--allow-empty": null });

      try {
        await git.push("origin", "main");
      } catch {
        // Might need to set upstream
        await git.push(["--set-upstream", "origin", "main"]);
      }
    },

    async pushResourceBatch(
      type: ResourceType,
      resources: Array<{
        id: string;
        data: Buffer;
        metadata?: Record<string, unknown>;
      }>,
      onProgress?: (done: number, total: number) => void
    ): Promise<{ pushed: number; failed: number }> {
      const total = resources.length;
      let pushed = 0;
      let failed = 0;

      const config = RESOURCE_CONFIGS[type];
      const typeDir = path.join(SYNC_DIR, config.storagePrefix);

      // Ensure directory exists
      await fs.mkdir(typeDir, { recursive: true });

      // Process in batches for parallel file writes
      for (let i = 0; i < resources.length; i += BATCH_SIZE) {
        const batch = resources.slice(i, i + BATCH_SIZE);

        // Write all files in this batch in parallel
        const results = await Promise.allSettled(
          batch.map(async (resource) => {
            // Verify each resource is encrypted before writing
            assertEncrypted(resource.data, `${type} ${resource.id}`);

            const resourcePath = getResourcePath(type, resource.id);
            await fs.mkdir(path.dirname(resourcePath), { recursive: true });
            await fs.writeFile(resourcePath, resource.data);
            return resourcePath;
          })
        );

        // Count successes/failures
        for (const result of results) {
          if (result.status === "fulfilled") {
            pushed++;
          } else {
            failed++;
          }
        }

        onProgress?.(pushed + failed, total);
      }

      // Single git add for all files in this type's directory
      await git.add(path.join(typeDir, "*.enc"));

      // Single commit
      await git.commit(`sync: ${pushed} ${type}`, { "--allow-empty": null });

      // Single push
      try {
        await git.push("origin", "main");
      } catch {
        await git.push(["--set-upstream", "origin", "main"]);
      }

      return { pushed, failed };
    },

    async pullResource(type: ResourceType, id: string): Promise<Buffer> {
      // Pull latest
      await git.pull("origin", "main").catch(() => {
        // Might fail if nothing to pull
      });

      const resourcePath = getResourcePath(type, id);
      return fs.readFile(resourcePath);
    },

    async listResources(type: ResourceType): Promise<RemoteResource[]> {
      // Pull latest
      await git.pull("origin", "main").catch(() => {});

      const config = RESOURCE_CONFIGS[type];
      const typeDir = path.join(SYNC_DIR, config.storagePrefix);

      try {
        // Use glob to find all .enc files, including nested ones
        const pattern = path.join(typeDir, "**", "*.enc");
        const files = await glob(pattern);

        return files.map((f) => {
          const relativePath = path.relative(typeDir, f);
          const id = parseResourceId(relativePath);
          return {
            id,
            type,
            existsLocally: false, // TODO: Check against local resources
          };
        });
      } catch {
        return [];
      }
    },

    async deleteResource(type: ResourceType, id: string): Promise<void> {
      const resourcePath = getResourcePath(type, id);

      await fs.unlink(resourcePath).catch(() => {});
      await git.add(resourcePath);
      await git.commit(`delete ${type}: ${id}`);
      await git.push("origin", "main");
    },
  };
}
