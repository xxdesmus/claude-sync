import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  loadSyncState,
  saveSyncState,
  updateResourceHash,
  getResourceHash,
  getResourceSyncRecord,
  updateResourceHashBatch,
  type SyncState,
} from "../syncState.js";

// Mock fs/promises
vi.mock("fs/promises", () => ({
  default: {
    readFile: vi.fn(),
    writeFile: vi.fn().mockResolvedValue(undefined),
    mkdir: vi.fn().mockResolvedValue(undefined),
  },
}));

import fs from "fs/promises";

describe("syncState", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-15T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("loadSyncState", () => {
    it("returns empty state when file does not exist", async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error("ENOENT"));

      const state = await loadSyncState();

      expect(state).toEqual({
        version: 1,
        resources: {},
      });
    });

    it("returns parsed state from file", async () => {
      const mockState: SyncState = {
        version: 1,
        resources: {
          sessions: {
            "session-1": {
              hash: "abc123",
              syncedAt: "2024-01-10T10:00:00.000Z",
            },
          },
        },
      };
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockState));

      const state = await loadSyncState();

      expect(state).toEqual(mockState);
    });

    it("returns empty state on invalid JSON", async () => {
      vi.mocked(fs.readFile).mockResolvedValue("invalid json");

      const state = await loadSyncState();

      expect(state).toEqual({
        version: 1,
        resources: {},
      });
    });
  });

  describe("saveSyncState", () => {
    it("creates directory and writes state to file", async () => {
      const state: SyncState = {
        version: 1,
        resources: {
          sessions: {
            "session-1": {
              hash: "abc123",
              syncedAt: "2024-01-10T10:00:00.000Z",
            },
          },
        },
      };

      await saveSyncState(state);

      expect(fs.mkdir).toHaveBeenCalledWith(
        expect.stringContaining(".claude-sync"),
        { recursive: true }
      );
      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining("sync-state.json"),
        JSON.stringify(state, null, 2)
      );
    });
  });

  describe("updateResourceHash", () => {
    it("adds hash for new resource", async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error("ENOENT"));

      await updateResourceHash("sessions", "session-1", "abc123");

      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('"session-1"')
      );
      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('"abc123"')
      );
      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining("2024-01-15T12:00:00.000Z")
      );
    });

    it("updates hash for existing resource", async () => {
      const existingState: SyncState = {
        version: 1,
        resources: {
          sessions: {
            "session-1": {
              hash: "old-hash",
              syncedAt: "2024-01-10T10:00:00.000Z",
            },
          },
        },
      };
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(existingState));

      await updateResourceHash("sessions", "session-1", "new-hash");

      const writeCall = vi.mocked(fs.writeFile).mock.calls[0];
      const written = JSON.parse(writeCall[1] as string) as SyncState;
      expect(written.resources.sessions?.["session-1"]?.hash).toBe("new-hash");
    });
  });

  describe("getResourceHash", () => {
    it("returns null when resource not found", async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error("ENOENT"));

      const hash = await getResourceHash("sessions", "session-1");

      expect(hash).toBeNull();
    });

    it("returns hash when resource exists", async () => {
      const state: SyncState = {
        version: 1,
        resources: {
          sessions: {
            "session-1": {
              hash: "abc123",
              syncedAt: "2024-01-10T10:00:00.000Z",
            },
          },
        },
      };
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(state));

      const hash = await getResourceHash("sessions", "session-1");

      expect(hash).toBe("abc123");
    });

    it("returns null for non-existent resource type", async () => {
      const state: SyncState = {
        version: 1,
        resources: {},
      };
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(state));

      const hash = await getResourceHash("sessions", "session-1");

      expect(hash).toBeNull();
    });
  });

  describe("getResourceSyncRecord", () => {
    it("returns null when resource not found", async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error("ENOENT"));

      const record = await getResourceSyncRecord("sessions", "session-1");

      expect(record).toBeNull();
    });

    it("returns full record when resource exists", async () => {
      const state: SyncState = {
        version: 1,
        resources: {
          sessions: {
            "session-1": {
              hash: "abc123",
              syncedAt: "2024-01-10T10:00:00.000Z",
            },
          },
        },
      };
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(state));

      const record = await getResourceSyncRecord("sessions", "session-1");

      expect(record).toEqual({
        hash: "abc123",
        syncedAt: "2024-01-10T10:00:00.000Z",
      });
    });
  });

  describe("updateResourceHashBatch", () => {
    it("updates multiple resources at once", async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error("ENOENT"));

      await updateResourceHashBatch([
        { type: "sessions", id: "session-1", hash: "hash1" },
        { type: "sessions", id: "session-2", hash: "hash2" },
        { type: "agents", id: "agent-1", hash: "hash3" },
      ]);

      const writeCall = vi.mocked(fs.writeFile).mock.calls[0];
      const written = JSON.parse(writeCall[1] as string) as SyncState;

      expect(written.resources.sessions?.["session-1"]?.hash).toBe("hash1");
      expect(written.resources.sessions?.["session-2"]?.hash).toBe("hash2");
      expect(written.resources.agents?.["agent-1"]?.hash).toBe("hash3");
    });

    it("preserves existing resources when updating", async () => {
      const existingState: SyncState = {
        version: 1,
        resources: {
          sessions: {
            "session-existing": {
              hash: "existing-hash",
              syncedAt: "2024-01-01T00:00:00.000Z",
            },
          },
        },
      };
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(existingState));

      await updateResourceHashBatch([
        { type: "sessions", id: "session-new", hash: "new-hash" },
      ]);

      const writeCall = vi.mocked(fs.writeFile).mock.calls[0];
      const written = JSON.parse(writeCall[1] as string) as SyncState;

      expect(written.resources.sessions?.["session-existing"]?.hash).toBe(
        "existing-hash"
      );
      expect(written.resources.sessions?.["session-new"]?.hash).toBe(
        "new-hash"
      );
    });
  });
});
