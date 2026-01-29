/**
 * @fileoverview Resource registry and factory functions.
 * Central module for accessing resource handlers and configurations.
 */

import type {
  ResourceType,
  ResourceHandler,
  ResourceTypeConfig,
} from "./types.js";
import { createSessionsHandler } from "./handlers/sessions.js";
import { createAgentsHandler } from "./handlers/agents.js";
import { createSettingsHandler } from "./handlers/settings.js";

export * from "./types.js";

/**
 * Configuration definitions for each resource type.
 * Includes display names, descriptions, sync strategies, and storage paths.
 */
export const RESOURCE_CONFIGS: Record<ResourceType, ResourceTypeConfig> = {
  sessions: {
    type: "sessions",
    displayName: "Sessions",
    description: "Claude Code conversation transcripts",
    strategy: "full",
    storagePrefix: "sessions/",
  },
  agents: {
    type: "agents",
    displayName: "Agents",
    description: "Custom agent definitions",
    strategy: "full",
    storagePrefix: "agents/",
  },
  settings: {
    type: "settings",
    displayName: "Settings",
    description: "Claude Code settings including enabled plugins (merged)",
    strategy: "merge",
    storagePrefix: "settings/",
  },
};

/**
 * Factory function to get the appropriate handler for a resource type.
 * @param type - The resource type to get a handler for.
 * @returns A ResourceHandler instance for the specified type.
 * @throws Error if the resource type is unknown.
 */
export function getResourceHandler(type: ResourceType): ResourceHandler {
  switch (type) {
    case "sessions":
      return createSessionsHandler();
    case "agents":
      return createAgentsHandler();
    case "settings":
      return createSettingsHandler();
    default:
      throw new Error(`Unknown resource type: ${type}`);
  }
}

/**
 * Parses and validates a resource type string.
 * @param type - The string to parse as a resource type.
 * @returns The validated ResourceType.
 * @throws Error if the type is not a valid resource type.
 */
export function parseResourceType(type: string): ResourceType {
  const validTypes: ResourceType[] = ["sessions", "agents", "settings"];
  if (!validTypes.includes(type as ResourceType)) {
    throw new Error(
      `Invalid resource type: ${type}. Valid types: ${validTypes.join(", ")}`
    );
  }
  return type as ResourceType;
}

/**
 * Type guard to check if a string is a valid resource type.
 * @param type - The string to check.
 * @returns True if the string is a valid ResourceType.
 */
export function isValidResourceType(type: string): type is ResourceType {
  return ["sessions", "agents", "settings"].includes(type);
}
