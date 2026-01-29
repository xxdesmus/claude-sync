import type { ResourceType, ResourceHandler, ResourceTypeConfig } from "./types.js";
import { createSessionsHandler } from "./handlers/sessions.js";
import { createAgentsHandler } from "./handlers/agents.js";
import { createSettingsHandler } from "./handlers/settings.js";

export * from "./types.js";

/**
 * Resource type configurations
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
 * Factory to get the appropriate handler for a resource type
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
 * Parse resource type from string, with validation
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
 * Check if a string is a valid resource type
 */
export function isValidResourceType(type: string): type is ResourceType {
  return ["sessions", "agents", "settings"].includes(type);
}
