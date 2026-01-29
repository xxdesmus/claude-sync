/**
 * @fileoverview Type definitions for the resource sync system.
 * Defines interfaces for resource types, handlers, and configuration.
 */

/**
 * Resource types supported by claude-sync.
 * - sessions: Claude Code conversation transcripts
 * - agents: Custom agent definitions
 * - settings: Claude Code settings (merged across machines)
 */
export type ResourceType = "sessions" | "agents" | "settings";

/**
 * Array of all supported resource types for iteration.
 */
export const ALL_RESOURCE_TYPES: ResourceType[] = [
  "sessions",
  "agents",
  "settings",
];

/**
 * Configuration for each resource type
 */
export interface ResourceTypeConfig {
  type: ResourceType;
  displayName: string;
  description: string;
  /** Storage strategy - 'full' replaces entire file, 'merge' merges with existing */
  strategy: "full" | "merge";
  /** Storage prefix in the backend (e.g., 'sessions/', 'agents/') */
  storagePrefix: string;
}

/**
 * Represents a single resource item found locally or remotely
 */
export interface ResourceItem {
  /** Unique identifier for this resource */
  id: string;
  /** Local file path (if exists locally) */
  path?: string;
  /** Last modified timestamp */
  modifiedAt?: Date;
  /** Additional metadata specific to resource type */
  metadata?: Record<string, unknown>;
}

/**
 * Options for finding local resources
 */
export interface FindResourceOptions {
  /** Only return resources modified since last sync */
  modifiedSinceLastSync?: boolean;
}

/**
 * Handler interface for each resource type
 */
export interface ResourceHandler {
  /** Configuration for this resource type */
  config: ResourceTypeConfig;

  /**
   * Find all local resources of this type
   */
  findLocal(options?: FindResourceOptions): Promise<ResourceItem[]>;

  /**
   * Read the content of a local resource
   */
  read(item: ResourceItem): Promise<Buffer>;

  /**
   * Write content to a local resource
   * Returns the local path where it was written
   */
  write(
    id: string,
    content: Buffer,
    metadata?: Record<string, unknown>
  ): Promise<string>;

  /**
   * Get the local path for a resource ID
   */
  getLocalPath(id: string, metadata?: Record<string, unknown>): Promise<string>;

  /**
   * Merge local and remote content (only for merge strategy)
   */
  merge?(local: Buffer, remote: Buffer): Promise<Buffer>;

  /**
   * Get the path for storing a conflicting version of a resource.
   * Used when keeping both local and remote during conflict resolution.
   */
  getConflictPath?(
    id: string,
    metadata?: Record<string, unknown>
  ): Promise<string>;
}

/**
 * Remote resource item from backend
 */
export interface RemoteResource {
  id: string;
  type: ResourceType;
  existsLocally: boolean;
  metadata?: Record<string, unknown>;
}
