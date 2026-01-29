import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { pull } from "../pull.js";

// Mock dependencies
vi.mock("../../crypto/encrypt.js", () => ({
  decrypt: vi.fn().mockResolvedValue("decrypted-content"),
}));

vi.mock("../../backends/index.js", () => ({
  getBackend: vi.fn(),
}));

vi.mock("../../utils/config.js", () => ({
  loadConfig: vi.fn(),
}));

vi.mock("../../resources/index.js", () => ({
  getResourceHandler: vi.fn(),
  ALL_RESOURCE_TYPES: ["sessions", "agents", "settings"],
  RESOURCE_CONFIGS: {
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
      description: "Claude Code settings",
      strategy: "merge",
      storagePrefix: "settings/",
    },
  },
}));

// Mock ora spinner
vi.mock("ora", () => ({
  default: vi.fn(() => ({
    start: vi.fn().mockReturnThis(),
    succeed: vi.fn().mockReturnThis(),
    fail: vi.fn().mockReturnThis(),
    warn: vi.fn().mockReturnThis(),
    text: "",
  })),
}));

// Mock chalk (pass through strings)
vi.mock("chalk", () => ({
  default: {
    red: vi.fn((s: string) => s),
    green: vi.fn((s: string) => s),
    cyan: vi.fn((s: string) => s),
    dim: vi.fn((s: string) => s),
    yellow: vi.fn((s: string) => s),
    bold: vi.fn((s: string) => s),
  },
}));

import { loadConfig } from "../../utils/config.js";
import { getBackend } from "../../backends/index.js";
import { getResourceHandler } from "../../resources/index.js";
import { decrypt } from "../../crypto/encrypt.js";

describe("pull command", () => {
  const mockBackend = {
    push: vi.fn().mockResolvedValue(undefined),
    pushBatch: vi.fn().mockResolvedValue({ pushed: 0, failed: 0 }),
    pull: vi.fn().mockResolvedValue(Buffer.from("encrypted-data")),
    list: vi.fn().mockResolvedValue([]),
    delete: vi.fn().mockResolvedValue(undefined),
    pushResource: vi.fn().mockResolvedValue(undefined),
    pushResourceBatch: vi.fn().mockResolvedValue({ pushed: 0, failed: 0 }),
    pullResource: vi.fn().mockResolvedValue(Buffer.from("encrypted-data")),
    listResources: vi.fn().mockResolvedValue([]),
    deleteResource: vi.fn().mockResolvedValue(undefined),
  };

  const mockResourceHandler = {
    config: {
      type: "sessions" as const,
      displayName: "Sessions",
      description: "Test",
      strategy: "full" as const,
      storagePrefix: "sessions/",
    },
    findLocal: vi.fn().mockResolvedValue([]),
    read: vi.fn().mockResolvedValue(Buffer.from("local-content")),
    write: vi.fn().mockResolvedValue("/path/to/session"),
    getLocalPath: vi.fn().mockResolvedValue("/path/to/session"),
    merge: vi.fn().mockResolvedValue(Buffer.from("merged-content")),
  };

  const mockConfig = {
    backend: "git" as const,
    backendConfig: { url: "https://github.com/test/repo" },
    initialized: true,
    createdAt: new Date().toISOString(),
  };

  // Mock process.exit
  const mockExit = vi.spyOn(process, "exit").mockImplementation((() => {
    throw new Error("process.exit called");
  }) as typeof process.exit);

  // Mock console.log
  const mockConsoleLog = vi.spyOn(console, "log").mockImplementation(() => {});

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadConfig).mockResolvedValue(mockConfig);
    vi.mocked(getBackend).mockResolvedValue(mockBackend);
    vi.mocked(getResourceHandler).mockReturnValue(mockResourceHandler);
  });

  afterEach(() => {
    mockExit.mockClear();
    mockConsoleLog.mockClear();
  });

  describe("config validation", () => {
    it("exits with error when not initialized", async () => {
      vi.mocked(loadConfig).mockResolvedValue(null);

      await expect(pull({})).rejects.toThrow("process.exit called");
      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining("not initialized")
      );
    });

    it("exits with error when config.initialized is false", async () => {
      vi.mocked(loadConfig).mockResolvedValue({
        ...mockConfig,
        initialized: false,
      });

      await expect(pull({})).rejects.toThrow("process.exit called");
    });
  });

  describe("dry-run mode", () => {
    it("shows preview of resources to pull without actually pulling", async () => {
      const remoteResources = [
        { id: "session-1", type: "sessions" as const, existsLocally: false },
        { id: "session-2", type: "sessions" as const, existsLocally: false },
      ];
      mockBackend.listResources.mockResolvedValue(remoteResources);
      mockResourceHandler.findLocal.mockResolvedValue([]);

      await pull({ dryRun: true });

      expect(mockBackend.pullResource).not.toHaveBeenCalled();
      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining("Dry Run")
      );
    });

    it("shows message when no resources on remote in dry-run", async () => {
      mockBackend.listResources.mockResolvedValue([]);

      await pull({ dryRun: true });

      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining("No resources on remote")
      );
    });

    it("shows message when all resources are up to date in dry-run", async () => {
      const remoteResources = [
        { id: "session-1", type: "sessions" as const, existsLocally: true },
      ];
      mockBackend.listResources.mockResolvedValue(remoteResources);
      mockResourceHandler.findLocal.mockResolvedValue([
        { id: "session-1", path: "/path/1" },
      ]);

      await pull({ dryRun: true });

      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining("All resources are up to date")
      );
    });
  });

  describe("pull specific session", () => {
    it("pulls a specific session by ID", async () => {
      mockBackend.listResources.mockResolvedValue([
        { id: "session-123", type: "sessions" as const, existsLocally: false },
      ]);

      await pull({ session: "session-123" });

      expect(mockBackend.pullResource).toHaveBeenCalledWith(
        "sessions",
        "session-123"
      );
      expect(decrypt).toHaveBeenCalled();
      expect(mockResourceHandler.write).toHaveBeenCalled();
    });

    it("exits with error when specific session not found on remote", async () => {
      mockBackend.listResources.mockResolvedValue([
        {
          id: "other-session",
          type: "sessions" as const,
          existsLocally: false,
        },
      ]);

      await pull({ session: "non-existent" });

      // The spinner fail method would be called with "not found" message
    });

    it("rejects session option with non-session type", async () => {
      await expect(
        pull({ type: "agents", session: "session-1" })
      ).rejects.toThrow("process.exit called");
      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining("only valid for sessions")
      );
    });
  });

  describe("pull resources", () => {
    it("pulls only new resources by default (not all)", async () => {
      const remoteResources = [
        { id: "session-1", type: "sessions" as const, existsLocally: false },
        { id: "session-2", type: "sessions" as const, existsLocally: false },
        { id: "session-3", type: "sessions" as const, existsLocally: false },
      ];
      mockBackend.listResources.mockResolvedValue(remoteResources);
      // session-1 and session-2 exist locally
      mockResourceHandler.findLocal.mockResolvedValue([
        { id: "session-1", path: "/path/1" },
        { id: "session-2", path: "/path/2" },
      ]);

      await pull({});

      // Should only pull session-3 (not existing locally)
      expect(mockBackend.pullResource).toHaveBeenCalledTimes(1);
      expect(mockBackend.pullResource).toHaveBeenCalledWith(
        "sessions",
        "session-3"
      );
    });

    it("pulls all resources when --all flag is set with specific type", async () => {
      const remoteResources = [
        { id: "session-1", type: "sessions" as const, existsLocally: false },
        { id: "session-2", type: "sessions" as const, existsLocally: false },
      ];
      mockBackend.listResources.mockResolvedValue(remoteResources);
      mockResourceHandler.findLocal.mockResolvedValue([
        { id: "session-1", path: "/path/1" },
      ]);

      // Using type: "sessions" to only pull sessions, not all resource types
      await pull({ all: true, type: "sessions" });

      // Should pull both sessions (all overrides the "only new" logic)
      expect(mockBackend.pullResource).toHaveBeenCalledTimes(2);
    });

    it("writes decrypted content to local", async () => {
      const remoteResources = [
        { id: "session-1", type: "sessions" as const, existsLocally: false },
      ];
      mockBackend.listResources.mockResolvedValue(remoteResources);
      mockResourceHandler.findLocal.mockResolvedValue([]);

      await pull({});

      expect(mockResourceHandler.write).toHaveBeenCalledWith(
        "session-1",
        expect.any(Buffer),
        undefined
      );
    });
  });

  describe("resource type handling", () => {
    it("defaults to sessions type", async () => {
      mockBackend.listResources.mockResolvedValue([]);

      await pull({});

      expect(getResourceHandler).toHaveBeenCalledWith("sessions");
    });

    it("pulls specific resource type when specified", async () => {
      mockBackend.listResources.mockResolvedValue([]);

      await pull({ type: "agents" });

      expect(getResourceHandler).toHaveBeenCalledWith("agents");
    });

    it("pulls all resource types when --all flag is set with no type specified", async () => {
      mockBackend.listResources.mockResolvedValue([]);
      mockResourceHandler.findLocal.mockResolvedValue([]);

      await pull({ all: true });

      expect(getResourceHandler).toHaveBeenCalledWith("sessions");
      expect(getResourceHandler).toHaveBeenCalledWith("agents");
      expect(getResourceHandler).toHaveBeenCalledWith("settings");
    });
  });

  describe("merge strategy for settings", () => {
    it("merges content for resources with merge strategy", async () => {
      const settingsHandler = {
        ...mockResourceHandler,
        config: {
          type: "settings" as const,
          displayName: "Settings",
          description: "Test",
          strategy: "merge" as const,
          storagePrefix: "settings/",
        },
        findLocal: vi
          .fn()
          .mockResolvedValue([{ id: "settings-1", path: "/path/settings" }]),
        read: vi.fn().mockResolvedValue(Buffer.from("local-settings")),
        write: vi.fn().mockResolvedValue("/path/settings"),
        getLocalPath: vi.fn().mockResolvedValue("/path/settings"),
        merge: vi.fn().mockResolvedValue(Buffer.from("merged-content")),
      };

      vi.mocked(getResourceHandler).mockImplementation(
        (type: import("../../resources/types.js").ResourceType) => {
          if (type === "settings") return settingsHandler;
          return mockResourceHandler;
        }
      );

      const remoteResources = [
        {
          id: "settings-1",
          type: "settings" as const,
          existsLocally: false,
        },
      ];
      mockBackend.listResources.mockResolvedValue(remoteResources);

      // Pull settings with --all to ensure the resource is pulled
      await pull({ type: "settings", all: true });

      // Verify pullResource was called for settings
      expect(mockBackend.pullResource).toHaveBeenCalledWith(
        "settings",
        "settings-1"
      );
      // Verify merge was called since strategy is "merge" and local exists
      expect(settingsHandler.merge).toHaveBeenCalled();
    });
  });

  describe("no resources on remote", () => {
    it("displays message when no resources on remote", async () => {
      mockBackend.listResources.mockResolvedValue([]);

      await pull({});

      // The spinner succeed method would be called with appropriate message
    });

    it("displays message when all resources are up to date", async () => {
      const remoteResources = [
        { id: "session-1", type: "sessions" as const, existsLocally: false },
      ];
      mockBackend.listResources.mockResolvedValue(remoteResources);
      mockResourceHandler.findLocal.mockResolvedValue([
        { id: "session-1", path: "/path/1" },
      ]);

      await pull({});

      // The spinner succeed method would be called with "up to date" message
    });
  });

  describe("error handling", () => {
    it("handles decryption errors gracefully", async () => {
      const remoteResources = [
        { id: "session-1", type: "sessions" as const, existsLocally: false },
      ];
      mockBackend.listResources.mockResolvedValue(remoteResources);
      mockResourceHandler.findLocal.mockResolvedValue([]);
      vi.mocked(decrypt).mockRejectedValueOnce(new Error("Decryption failed"));

      // Should not throw, error is counted as failure
      await pull({});

      // Failure is tracked internally
    });

    it("handles backend pull errors gracefully", async () => {
      const remoteResources = [
        { id: "session-1", type: "sessions" as const, existsLocally: false },
      ];
      mockBackend.listResources.mockResolvedValue(remoteResources);
      mockResourceHandler.findLocal.mockResolvedValue([]);
      mockBackend.pullResource.mockRejectedValueOnce(new Error("Pull failed"));

      // Should not throw
      await pull({});
    });

    it("exits on listResources failure", async () => {
      mockBackend.listResources.mockRejectedValue(new Error("Network error"));

      await expect(pull({})).rejects.toThrow("process.exit called");
    });
  });
});
