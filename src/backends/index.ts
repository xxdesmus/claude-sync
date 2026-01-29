/**
 * @fileoverview Backend factory and interface definitions.
 * Provides a unified interface for different storage backends (Git, S3).
 */

import { createGitBackend } from "./git.js";
import { createS3Backend, type S3Config } from "./s3.js";
import type { ResourceType, RemoteResource } from "../resources/types.js";

/**
 * Represents a session stored in the remote backend.
 * Used for legacy session-only operations.
 */
export interface RemoteSession {
  id: string;
  project: string;
  existsLocally: boolean;
}

/**
 * Backend interface defining operations for storing and retrieving encrypted resources.
 * Implementations include Git and S3-compatible storage backends.
 */
export interface Backend {
  /**
   * Pushes a single session to the backend (legacy method).
   * @param sessionId - Unique identifier for the session.
   * @param encryptedData - Encrypted session data.
   */
  push(sessionId: string, encryptedData: Buffer): Promise<void>;

  /**
   * Pushes multiple sessions in batch (legacy method).
   * @param sessions - Array of session objects with id and encrypted data.
   * @param onProgress - Optional callback for progress updates.
   * @returns Object containing counts of pushed and failed sessions.
   */
  pushBatch(
    sessions: Array<{ id: string; data: Buffer }>,
    onProgress?: (done: number, total: number) => void
  ): Promise<{ pushed: number; failed: number }>;

  /**
   * Pulls a session from the backend (legacy method).
   * @param sessionId - Unique identifier for the session.
   * @returns Encrypted session data buffer.
   */
  pull(sessionId: string): Promise<Buffer>;

  /**
   * Lists all sessions in the backend (legacy method).
   * @returns Array of remote session metadata.
   */
  list(): Promise<RemoteSession[]>;

  /**
   * Deletes a session from the backend (legacy method).
   * @param sessionId - Unique identifier for the session to delete.
   */
  delete(sessionId: string): Promise<void>;

  /**
   * Pushes a single resource of any type to the backend.
   * @param type - The resource type (sessions, agents, settings).
   * @param id - Unique identifier for the resource.
   * @param encryptedData - Encrypted resource data.
   * @param metadata - Optional metadata associated with the resource.
   */
  pushResource(
    type: ResourceType,
    id: string,
    encryptedData: Buffer,
    metadata?: Record<string, unknown>
  ): Promise<void>;

  /**
   * Pushes multiple resources of the same type in batch.
   * @param type - The resource type (sessions, agents, settings).
   * @param resources - Array of resource objects with id, data, and optional metadata.
   * @param onProgress - Optional callback for progress updates.
   * @returns Object containing counts of pushed and failed resources.
   */
  pushResourceBatch(
    type: ResourceType,
    resources: Array<{
      id: string;
      data: Buffer;
      metadata?: Record<string, unknown>;
    }>,
    onProgress?: (done: number, total: number) => void
  ): Promise<{ pushed: number; failed: number }>;

  /**
   * Pulls a resource of any type from the backend.
   * @param type - The resource type (sessions, agents, settings).
   * @param id - Unique identifier for the resource.
   * @returns Encrypted resource data buffer.
   */
  pullResource(type: ResourceType, id: string): Promise<Buffer>;

  /**
   * Lists all resources of a specific type in the backend.
   * @param type - The resource type to list.
   * @returns Array of remote resource metadata.
   */
  listResources(type: ResourceType): Promise<RemoteResource[]>;

  /**
   * Deletes a resource from the backend.
   * @param type - The resource type (sessions, agents, settings).
   * @param id - Unique identifier for the resource to delete.
   */
  deleteResource(type: ResourceType, id: string): Promise<void>;
}

/**
 * Configuration for claude-sync stored in ~/.claude-sync/config.json.
 */
export interface Config {
  /** The storage backend type being used. */
  backend: "git" | "s3";
  /** Backend-specific configuration (URL for git, bucket/endpoint for S3). */
  backendConfig: Record<string, string>;
  /** Whether claude-sync has been initialized. */
  initialized: boolean;
  /** ISO timestamp of when claude-sync was initialized. */
  createdAt: string;
}

/**
 * Factory function that creates the appropriate backend based on configuration.
 * @param config - The claude-sync configuration specifying the backend type.
 * @returns A Backend instance for the configured storage type.
 * @throws Error if the backend type is unknown.
 */
export async function getBackend(config: Config): Promise<Backend> {
  switch (config.backend) {
    case "git":
      return createGitBackend();
    case "s3":
      return createS3Backend(config.backendConfig as unknown as S3Config);
    default:
      throw new Error(`Unknown backend: ${config.backend}`);
  }
}
