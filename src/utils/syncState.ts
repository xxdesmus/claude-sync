/**
 * @fileoverview Sync state tracking for conflict detection.
 * Stores content hashes for resources to detect changes since last sync.
 */

import fs from "fs/promises";
import path from "path";
import { homedir } from "os";
import type { ResourceType } from "../resources/types.js";

/** Directory for claude-sync configuration and data. */
const CONFIG_DIR = path.join(homedir(), ".claude-sync");
/** Path to the sync state file. */
const SYNC_STATE_FILE = path.join(CONFIG_DIR, "sync-state.json");

/**
 * Record of a synced resource's state.
 */
export interface ResourceSyncRecord {
  /** SHA-256 hash of the content at last sync */
  hash: string;
  /** ISO timestamp of when this resource was synced */
  syncedAt: string;
}

/**
 * Full sync state structure.
 */
export interface SyncState {
  /** Version for future migrations */
  version: 1;
  /** Resource states indexed by type and ID */
  resources: {
    [type in ResourceType]?: {
      [id: string]: ResourceSyncRecord;
    };
  };
}

/**
 * Creates an empty sync state object.
 */
function createEmptySyncState(): SyncState {
  return {
    version: 1,
    resources: {},
  };
}

/**
 * Loads the sync state from disk.
 * @returns The sync state object, or an empty state if not found.
 */
export async function loadSyncState(): Promise<SyncState> {
  try {
    const data = await fs.readFile(SYNC_STATE_FILE, "utf-8");
    return JSON.parse(data) as SyncState;
  } catch {
    return createEmptySyncState();
  }
}

/**
 * Saves the sync state to disk.
 * @param state - The sync state to save.
 */
export async function saveSyncState(state: SyncState): Promise<void> {
  await fs.mkdir(CONFIG_DIR, { recursive: true });
  await fs.writeFile(SYNC_STATE_FILE, JSON.stringify(state, null, 2));
}

/**
 * Updates or adds the hash record for a resource.
 * @param type - The resource type.
 * @param id - The resource ID.
 * @param hash - The content hash.
 */
export async function updateResourceHash(
  type: ResourceType,
  id: string,
  hash: string
): Promise<void> {
  const state = await loadSyncState();

  if (!state.resources[type]) {
    state.resources[type] = {};
  }

  state.resources[type]![id] = {
    hash,
    syncedAt: new Date().toISOString(),
  };

  await saveSyncState(state);
}

/**
 * Gets the stored hash for a resource.
 * @param type - The resource type.
 * @param id - The resource ID.
 * @returns The stored hash, or null if not found.
 */
export async function getResourceHash(
  type: ResourceType,
  id: string
): Promise<string | null> {
  const state = await loadSyncState();
  return state.resources[type]?.[id]?.hash ?? null;
}

/**
 * Gets the full sync record for a resource.
 * @param type - The resource type.
 * @param id - The resource ID.
 * @returns The sync record, or null if not found.
 */
export async function getResourceSyncRecord(
  type: ResourceType,
  id: string
): Promise<ResourceSyncRecord | null> {
  const state = await loadSyncState();
  return state.resources[type]?.[id] ?? null;
}

/**
 * Batch updates multiple resource hashes efficiently.
 * @param updates - Array of updates with type, id, and hash.
 */
export async function updateResourceHashBatch(
  updates: Array<{ type: ResourceType; id: string; hash: string }>
): Promise<void> {
  const state = await loadSyncState();
  const now = new Date().toISOString();

  for (const { type, id, hash } of updates) {
    if (!state.resources[type]) {
      state.resources[type] = {};
    }
    state.resources[type]![id] = {
      hash,
      syncedAt: now,
    };
  }

  await saveSyncState(state);
}
