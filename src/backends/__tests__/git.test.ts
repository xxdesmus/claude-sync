import { describe, it, expect, vi, beforeEach } from "vitest";
import path from "path";
import { homedir } from "os";
import { randomBytes } from "crypto";
import { encryptWithKey } from "../../crypto/encrypt.js";

// Create mock git instance
const mockGitInstance = {
  checkIsRepo: vi.fn().mockResolvedValue(false),
  getRemotes: vi.fn().mockResolvedValue([]),
  remote: vi.fn().mockResolvedValue(undefined),
  pull: vi.fn().mockResolvedValue(undefined),
  init: vi.fn().mockResolvedValue(undefined),
  addRemote: vi.fn().mockResolvedValue(undefined),
  clone: vi.fn().mockResolvedValue(undefined),
  add: vi.fn().mockResolvedValue(undefined),
  commit: vi.fn().mockResolvedValue(undefined),
  push: vi.fn().mockResolvedValue(undefined),
};

// Mock dependencies before importing the module
vi.mock("fs/promises", () => ({
  default: {
    mkdir: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockResolvedValue(Buffer.from("test")),
    unlink: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("glob", () => ({
  glob: vi.fn().mockResolvedValue([]),
}));

// Mock simple-git
vi.mock("simple-git", () => ({
  default: vi.fn((cwd?: string) => {
    if (cwd) {
      return mockGitInstance;
    }
    // For simpleGit() without cwd (used in clone)
    return {
      clone: mockGitInstance.clone,
    };
  }),
}));

// Import after mocks are set up
import fs from "fs/promises";
import { glob } from "glob";
import { initGitBackend, createGitBackend } from "../git.js";

const SYNC_DIR = path.join(homedir(), ".claude-sync", "repo");

// Helper to create properly encrypted test data
const testKey = randomBytes(32);
function createEncryptedData(plaintext: string): Buffer {
  return encryptWithKey(plaintext, testKey);
}

// Helper for fs.readFile mock which needs string return
function createEncryptedDataString(plaintext: string): string {
  return encryptWithKey(plaintext, testKey).toString("utf-8");
}

describe("initGitBackend", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates sync directory", async () => {
    mockGitInstance.checkIsRepo.mockResolvedValue(false);
    mockGitInstance.clone.mockRejectedValue(new Error("empty repo"));

    await initGitBackend("https://github.com/user/repo.git");

    expect(fs.mkdir).toHaveBeenCalledWith(SYNC_DIR, { recursive: true });
  });

  it("initializes empty repo when clone fails", async () => {
    mockGitInstance.checkIsRepo.mockResolvedValue(false);
    mockGitInstance.clone.mockRejectedValue(new Error("empty repo"));

    await initGitBackend("https://github.com/user/repo.git");

    expect(mockGitInstance.init).toHaveBeenCalled();
    expect(mockGitInstance.addRemote).toHaveBeenCalledWith(
      "origin",
      "https://github.com/user/repo.git"
    );
  });

  it("updates remote URL if already initialized with different URL", async () => {
    mockGitInstance.checkIsRepo.mockResolvedValue(true);
    mockGitInstance.getRemotes.mockResolvedValue([
      { name: "origin", refs: { fetch: "https://github.com/old/repo.git" } },
    ]);
    mockGitInstance.pull.mockResolvedValue(undefined);

    await initGitBackend("https://github.com/new/repo.git");

    expect(mockGitInstance.remote).toHaveBeenCalledWith([
      "set-url",
      "origin",
      "https://github.com/new/repo.git",
    ]);
  });

  it("does not update remote URL if already correct", async () => {
    mockGitInstance.checkIsRepo.mockResolvedValue(true);
    mockGitInstance.getRemotes.mockResolvedValue([
      { name: "origin", refs: { fetch: "https://github.com/user/repo.git" } },
    ]);
    mockGitInstance.pull.mockResolvedValue(undefined);

    await initGitBackend("https://github.com/user/repo.git");

    expect(mockGitInstance.remote).not.toHaveBeenCalled();
  });

  it("creates resource directories", async () => {
    mockGitInstance.checkIsRepo.mockResolvedValue(false);
    mockGitInstance.clone.mockRejectedValue(new Error("empty repo"));

    await initGitBackend("https://github.com/user/repo.git");

    expect(fs.mkdir).toHaveBeenCalledWith(path.join(SYNC_DIR, "sessions"), {
      recursive: true,
    });
    expect(fs.mkdir).toHaveBeenCalledWith(path.join(SYNC_DIR, "agents"), {
      recursive: true,
    });
    expect(fs.mkdir).toHaveBeenCalledWith(path.join(SYNC_DIR, "settings"), {
      recursive: true,
    });
  });

  it("handles pull failure on existing repo gracefully", async () => {
    mockGitInstance.checkIsRepo.mockResolvedValue(true);
    mockGitInstance.getRemotes.mockResolvedValue([
      { name: "origin", refs: { fetch: "https://github.com/user/repo.git" } },
    ]);
    mockGitInstance.pull.mockRejectedValue(new Error("nothing to pull"));

    // Should not throw
    await expect(
      initGitBackend("https://github.com/user/repo.git")
    ).resolves.not.toThrow();
  });
});

describe("createGitBackend", () => {
  let backend: ReturnType<typeof createGitBackend>;

  beforeEach(() => {
    vi.clearAllMocks();
    backend = createGitBackend();
  });

  describe("push (legacy)", () => {
    it("delegates to pushResource with sessions type", async () => {
      const encryptedData = createEncryptedData("test session data");

      await backend.push("session-123", encryptedData);

      expect(fs.writeFile).toHaveBeenCalled();
      expect(mockGitInstance.add).toHaveBeenCalled();
      expect(mockGitInstance.commit).toHaveBeenCalledWith(
        "sync sessions: session-123",
        { "--allow-empty": null }
      );
    });
  });

  describe("pushResource", () => {
    it("writes encrypted data to correct path", async () => {
      const encryptedData = createEncryptedData("test data");

      await backend.pushResource("sessions", "session-123", encryptedData);

      expect(fs.writeFile).toHaveBeenCalledWith(
        path.join(SYNC_DIR, "sessions/", "session-123.enc"),
        encryptedData
      );
    });

    it("sanitizes session IDs with slashes", async () => {
      const encryptedData = createEncryptedData("test data");

      await backend.pushResource("sessions", "dir/session-123", encryptedData);

      expect(fs.writeFile).toHaveBeenCalledWith(
        path.join(SYNC_DIR, "sessions/", "dir_session-123.enc"),
        encryptedData
      );
    });

    it("commits and pushes to git", async () => {
      const encryptedData = createEncryptedData("test data");

      await backend.pushResource("sessions", "session-123", encryptedData);

      expect(mockGitInstance.add).toHaveBeenCalled();
      expect(mockGitInstance.commit).toHaveBeenCalledWith(
        "sync sessions: session-123",
        { "--allow-empty": null }
      );
      expect(mockGitInstance.push).toHaveBeenCalledWith("origin", "main");
    });

    it("sets upstream on first push", async () => {
      const encryptedData = createEncryptedData("test data");
      mockGitInstance.push
        .mockRejectedValueOnce(new Error("no upstream"))
        .mockResolvedValueOnce(undefined);

      await backend.pushResource("sessions", "session-123", encryptedData);

      expect(mockGitInstance.push).toHaveBeenCalledWith("origin", "main");
      expect(mockGitInstance.push).toHaveBeenCalledWith([
        "--set-upstream",
        "origin",
        "main",
      ]);
    });

    it("works with different resource types", async () => {
      const encryptedData = createEncryptedData("agent data");

      await backend.pushResource("agents", "my-agent", encryptedData);

      expect(fs.writeFile).toHaveBeenCalledWith(
        path.join(SYNC_DIR, "agents/", "my-agent.enc"),
        encryptedData
      );
      expect(mockGitInstance.commit).toHaveBeenCalledWith(
        "sync agents: my-agent",
        { "--allow-empty": null }
      );
    });

    it("throws error for unencrypted data", async () => {
      const plaintextData = Buffer.from('{"unencrypted": "data"}');

      await expect(
        backend.pushResource("sessions", "session-123", plaintextData)
      ).rejects.toThrow("Security error");
    });
  });

  describe("pushResourceBatch", () => {
    it("writes multiple resources in parallel", async () => {
      const resources = [
        { id: "session-1", data: createEncryptedData("data1") },
        { id: "session-2", data: createEncryptedData("data2") },
      ];

      const result = await backend.pushResourceBatch("sessions", resources);

      expect(result.pushed).toBe(2);
      expect(result.failed).toBe(0);
      expect(fs.writeFile).toHaveBeenCalledTimes(2);
    });

    it("calls progress callback", async () => {
      const resources = [
        { id: "session-1", data: createEncryptedData("data1") },
        { id: "session-2", data: createEncryptedData("data2") },
      ];
      const onProgress = vi.fn();

      await backend.pushResourceBatch("sessions", resources, onProgress);

      expect(onProgress).toHaveBeenCalled();
    });

    it("counts failed writes", async () => {
      const resources = [
        { id: "session-1", data: createEncryptedData("data1") },
        { id: "session-2", data: createEncryptedData("data2") },
      ];

      vi.mocked(fs.writeFile)
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error("write failed"));

      const result = await backend.pushResourceBatch("sessions", resources);

      expect(result.pushed).toBe(1);
      expect(result.failed).toBe(1);
    });

    it("makes single git commit for batch", async () => {
      const resources = [
        { id: "session-1", data: createEncryptedData("data1") },
        { id: "session-2", data: createEncryptedData("data2") },
      ];

      await backend.pushResourceBatch("sessions", resources);

      expect(mockGitInstance.commit).toHaveBeenCalledTimes(1);
      expect(mockGitInstance.commit).toHaveBeenCalledWith("sync: 2 sessions", {
        "--allow-empty": null,
      });
    });

    it("handles empty batch", async () => {
      const resources: Array<{ id: string; data: Buffer }> = [];

      const result = await backend.pushResourceBatch("sessions", resources);

      expect(result.pushed).toBe(0);
      expect(result.failed).toBe(0);
    });

    it("rejects unencrypted resources in batch", async () => {
      const resources = [
        { id: "session-1", data: Buffer.from('{"plaintext": "data"}') },
      ];

      const result = await backend.pushResourceBatch("sessions", resources);

      // assertEncrypted throws, so the resource fails
      expect(result.failed).toBe(1);
      expect(result.pushed).toBe(0);
    });
  });

  describe("pullResource", () => {
    it("pulls latest from git before reading", async () => {
      const mockData = createEncryptedDataString("pulled data");
      vi.mocked(fs.readFile).mockResolvedValue(mockData);

      await backend.pullResource("sessions", "session-123");

      expect(mockGitInstance.pull).toHaveBeenCalledWith("origin", "main");
    });

    it("reads file from correct path", async () => {
      const mockData = createEncryptedDataString("pulled data");
      vi.mocked(fs.readFile).mockResolvedValue(mockData);

      const result = await backend.pullResource("sessions", "session-123");

      expect(fs.readFile).toHaveBeenCalledWith(
        path.join(SYNC_DIR, "sessions/", "session-123.enc")
      );
      expect(result).toEqual(mockData);
    });

    it("handles pull failure gracefully", async () => {
      const mockData = createEncryptedDataString("pulled data");
      vi.mocked(fs.readFile).mockResolvedValue(mockData);
      mockGitInstance.pull.mockRejectedValue(new Error("nothing to pull"));

      // Should not throw
      await expect(
        backend.pullResource("sessions", "session-123")
      ).resolves.toEqual(mockData);
    });

    it("throws when file does not exist", async () => {
      vi.mocked(fs.readFile).mockRejectedValue(
        Object.assign(new Error("ENOENT"), { code: "ENOENT" })
      );

      await expect(
        backend.pullResource("sessions", "nonexistent")
      ).rejects.toThrow();
    });
  });

  describe("listResources", () => {
    it("pulls latest before listing", async () => {
      vi.mocked(glob).mockResolvedValue([]);

      await backend.listResources("sessions");

      expect(mockGitInstance.pull).toHaveBeenCalledWith("origin", "main");
    });

    it("returns empty array when no files found", async () => {
      vi.mocked(glob).mockResolvedValue([]);

      const result = await backend.listResources("sessions");

      expect(result).toEqual([]);
    });

    it("parses resource IDs from filenames", async () => {
      vi.mocked(glob).mockResolvedValue([
        path.join(SYNC_DIR, "sessions/", "session-123.enc"),
        path.join(SYNC_DIR, "sessions/", "session-456.enc"),
      ]);

      const result = await backend.listResources("sessions");

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe("session-123");
      expect(result[1].id).toBe("session-456");
    });

    it("converts underscores back to slashes in IDs", async () => {
      vi.mocked(glob).mockResolvedValue([
        path.join(SYNC_DIR, "sessions/", "dir_session-123.enc"),
      ]);

      const result = await backend.listResources("sessions");

      expect(result[0].id).toBe("dir/session-123");
    });

    it("handles glob errors gracefully", async () => {
      vi.mocked(glob).mockRejectedValue(new Error("glob failed"));

      const result = await backend.listResources("sessions");

      expect(result).toEqual([]);
    });

    it("sets correct type on returned resources", async () => {
      vi.mocked(glob).mockResolvedValue([
        path.join(SYNC_DIR, "agents/", "my-agent.enc"),
      ]);

      const result = await backend.listResources("agents");

      expect(result[0].type).toBe("agents");
    });
  });

  describe("list (legacy)", () => {
    it("delegates to listResources", async () => {
      vi.mocked(glob).mockResolvedValue([
        path.join(SYNC_DIR, "sessions/", "session-123.enc"),
      ]);

      const result = await backend.list();

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("session-123");
      expect(result[0].project).toBe("unknown"); // default when no metadata
    });
  });

  describe("deleteResource", () => {
    it("deletes file from filesystem", async () => {
      await backend.deleteResource("sessions", "session-123");

      expect(fs.unlink).toHaveBeenCalledWith(
        path.join(SYNC_DIR, "sessions/", "session-123.enc")
      );
    });

    it("commits deletion to git", async () => {
      await backend.deleteResource("sessions", "session-123");

      expect(mockGitInstance.add).toHaveBeenCalled();
      expect(mockGitInstance.commit).toHaveBeenCalledWith(
        "delete sessions: session-123"
      );
      expect(mockGitInstance.push).toHaveBeenCalledWith("origin", "main");
    });

    it("handles missing file gracefully", async () => {
      vi.mocked(fs.unlink).mockRejectedValue(new Error("file not found"));

      // Should not throw
      await expect(
        backend.deleteResource("sessions", "session-123")
      ).resolves.not.toThrow();
    });
  });

  describe("delete (legacy)", () => {
    it("delegates to deleteResource", async () => {
      await backend.delete("session-123");

      expect(fs.unlink).toHaveBeenCalledWith(
        path.join(SYNC_DIR, "sessions/", "session-123.enc")
      );
    });
  });
});
