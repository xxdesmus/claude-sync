import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { push } from "../push.js";

// Mock dependencies
vi.mock("../../crypto/encrypt.js", () => ({
  encrypt: vi.fn().mockResolvedValue(Buffer.from("encrypted-data")),
  hashContent: vi.fn().mockReturnValue("mock-hash-value"),
}));

vi.mock("../../utils/syncState.js", () => ({
  updateResourceHashBatch: vi.fn().mockResolvedValue(undefined),
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
import { encrypt } from "../../crypto/encrypt.js";

describe("push command", () => {
  const mockBackend = {
    push: vi.fn().mockResolvedValue(undefined),
    pushBatch: vi.fn().mockResolvedValue({ pushed: 0, failed: 0 }),
    pull: vi.fn().mockResolvedValue(Buffer.from("")),
    list: vi.fn().mockResolvedValue([]),
    delete: vi.fn().mockResolvedValue(undefined),
    pushResource: vi.fn().mockResolvedValue(undefined),
    pushResourceBatch: vi.fn().mockResolvedValue({ pushed: 0, failed: 0 }),
    pullResource: vi.fn().mockResolvedValue(Buffer.from("")),
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
    read: vi.fn().mockResolvedValue(Buffer.from("session-content")),
    write: vi.fn().mockResolvedValue("/path/to/session"),
    getLocalPath: vi.fn().mockResolvedValue("/path/to/session"),
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

      await expect(push({})).rejects.toThrow("process.exit called");
      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining("not initialized")
      );
    });

    it("exits with error when config.initialized is false", async () => {
      vi.mocked(loadConfig).mockResolvedValue({
        ...mockConfig,
        initialized: false,
      });

      await expect(push({})).rejects.toThrow("process.exit called");
    });

    it("allows dry-run without initialized config", async () => {
      vi.mocked(loadConfig).mockResolvedValue(null);
      mockResourceHandler.findLocal.mockResolvedValue([]);

      // Should not throw
      await push({ dryRun: true });
      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining("Dry Run")
      );
    });
  });

  describe("dry-run mode", () => {
    it("shows preview of resources to push without actually pushing", async () => {
      const mockResources = [
        { id: "session-1", path: "/path/to/session-1" },
        { id: "session-2", path: "/path/to/session-2" },
      ];
      mockResourceHandler.findLocal.mockResolvedValue(mockResources);

      await push({ dryRun: true });

      expect(mockBackend.pushResource).not.toHaveBeenCalled();
      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining("Dry Run")
      );
    });

    it("shows message when no resources to push in dry-run", async () => {
      mockResourceHandler.findLocal.mockResolvedValue([]);

      await push({ dryRun: true });

      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining("No resources to push")
      );
    });
  });

  describe("push single resource", () => {
    it("pushes a single session when one resource found", async () => {
      const mockResource = { id: "session-123", path: "/path/to/session" };
      mockResourceHandler.findLocal.mockResolvedValue([mockResource]);

      await push({});

      expect(mockResourceHandler.read).toHaveBeenCalledWith(mockResource);
      expect(encrypt).toHaveBeenCalled();
      expect(mockBackend.pushResource).toHaveBeenCalledWith(
        "sessions",
        "session-123",
        expect.any(Buffer),
        undefined
      );
    });

    it("pushes specific session by ID", async () => {
      const mockResources = [
        { id: "session-1", path: "/path/1" },
        { id: "session-2", path: "/path/2" },
      ];
      mockResourceHandler.findLocal.mockResolvedValue(mockResources);

      await push({ session: "session-2" });

      expect(mockResourceHandler.read).toHaveBeenCalledWith(mockResources[1]);
      expect(mockBackend.pushResource).toHaveBeenCalled();
    });

    it("exits with error when specific session not found", async () => {
      mockResourceHandler.findLocal.mockResolvedValue([
        { id: "session-1", path: "/path/1" },
      ]);

      await expect(push({ session: "non-existent" })).rejects.toThrow(
        "process.exit called"
      );
      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining("not found")
      );
    });

    it("pushes specific file path", async () => {
      await push({ file: "/path/to/specific/file.jsonl" });

      expect(mockResourceHandler.read).toHaveBeenCalled();
      expect(mockBackend.pushResource).toHaveBeenCalled();
    });
  });

  describe("push multiple resources (batch)", () => {
    it("uses batch push for multiple resources", async () => {
      const mockResources = [
        { id: "session-1", path: "/path/1" },
        { id: "session-2", path: "/path/2" },
        { id: "session-3", path: "/path/3" },
      ];
      mockResourceHandler.findLocal.mockResolvedValue(mockResources);
      mockBackend.pushResourceBatch.mockResolvedValue({ pushed: 3, failed: 0 });

      await push({});

      expect(mockBackend.pushResourceBatch).toHaveBeenCalled();
    });

    it("reports partial failures in batch push", async () => {
      const mockResources = [
        { id: "session-1", path: "/path/1" },
        { id: "session-2", path: "/path/2" },
      ];
      mockResourceHandler.findLocal.mockResolvedValue(mockResources);
      mockBackend.pushResourceBatch.mockResolvedValue({ pushed: 1, failed: 1 });

      await push({});

      expect(mockBackend.pushResourceBatch).toHaveBeenCalled();
    });
  });

  describe("resource type handling", () => {
    it("defaults to sessions type", async () => {
      mockResourceHandler.findLocal.mockResolvedValue([]);

      await push({});

      expect(getResourceHandler).toHaveBeenCalledWith("sessions");
    });

    it("pushes specific resource type when specified", async () => {
      mockResourceHandler.findLocal.mockResolvedValue([]);

      await push({ type: "agents" });

      expect(getResourceHandler).toHaveBeenCalledWith("agents");
    });

    it("pushes all resource types when --all flag is set", async () => {
      mockResourceHandler.findLocal.mockResolvedValue([]);

      await push({ all: true });

      expect(getResourceHandler).toHaveBeenCalledWith("sessions");
      expect(getResourceHandler).toHaveBeenCalledWith("agents");
      expect(getResourceHandler).toHaveBeenCalledWith("settings");
    });

    it("rejects session-specific options with non-session type", async () => {
      await expect(
        push({ type: "agents", session: "session-1" })
      ).rejects.toThrow("process.exit called");
      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining("only valid for sessions")
      );
    });
  });

  describe("no resources to push", () => {
    it("displays message when no resources to push", async () => {
      mockResourceHandler.findLocal.mockResolvedValue([]);

      await push({});

      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining("No sessions to push")
      );
    });
  });

  describe("error handling", () => {
    it("handles encryption errors gracefully for single resource", async () => {
      const mockResource = { id: "session-1", path: "/path/1" };
      mockResourceHandler.findLocal.mockResolvedValue([mockResource]);
      vi.mocked(encrypt).mockRejectedValueOnce(new Error("Encryption failed"));

      // Should not throw, just report failure via spinner
      await push({});

      // The ora spinner's fail method would be called
    });

    it("handles backend push errors gracefully", async () => {
      const mockResource = { id: "session-1", path: "/path/1" };
      mockResourceHandler.findLocal.mockResolvedValue([mockResource]);
      mockBackend.pushResource.mockRejectedValueOnce(new Error("Push failed"));

      // Should not throw, just report failure via spinner
      await push({});
    });
  });
});
