import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { init } from "../init.js";

// Mock dependencies
vi.mock("../../crypto/keys.js", () => ({
  generateKey: vi.fn().mockResolvedValue(Buffer.alloc(32)),
  saveKey: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../backends/git.js", () => ({
  initGitBackend: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../utils/config.js", () => ({
  saveConfig: vi.fn().mockResolvedValue(undefined),
}));

// Mock inquirer
vi.mock("inquirer", () => ({
  default: {
    prompt: vi.fn(),
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

import { generateKey, saveKey } from "../../crypto/keys.js";
import { initGitBackend } from "../../backends/git.js";
import { saveConfig } from "../../utils/config.js";
import inquirer from "inquirer";

describe("init command", () => {
  // Mock console.log
  const mockConsoleLog = vi.spyOn(console, "log").mockImplementation(() => {});

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    mockConsoleLog.mockClear();
  });

  describe("git backend initialization", () => {
    it("initializes with --git flag", async () => {
      await init({ git: "https://github.com/user/repo" });

      expect(generateKey).toHaveBeenCalled();
      expect(saveKey).toHaveBeenCalled();
      expect(initGitBackend).toHaveBeenCalledWith(
        "https://github.com/user/repo"
      );
      expect(saveConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          backend: "git",
          backendConfig: { url: "https://github.com/user/repo" },
          initialized: true,
        })
      );
    });

    it("displays success message after git init", async () => {
      await init({ git: "https://github.com/user/repo" });

      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining("initialized successfully")
      );
    });

    it("displays next steps after initialization", async () => {
      await init({ git: "https://github.com/user/repo" });

      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining("Next steps")
      );
      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining("claude-sync install")
      );
    });

    it("displays security reminder", async () => {
      await init({ git: "https://github.com/user/repo" });

      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining("Important")
      );
      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining("encryption key")
      );
    });
  });

  describe("S3 backend initialization", () => {
    it("initializes with --s3 flag", async () => {
      await init({ s3: "my-bucket" });

      expect(generateKey).toHaveBeenCalled();
      expect(saveKey).toHaveBeenCalled();
      expect(saveConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          backend: "s3",
          backendConfig: { bucket: "my-bucket" },
          initialized: true,
        })
      );
    });

    it("includes region when specified with --s3", async () => {
      await init({ s3: "my-bucket", region: "us-west-2" });

      expect(saveConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          backendConfig: expect.objectContaining({
            bucket: "my-bucket",
            region: "us-west-2",
          }),
        })
      );
    });

    it("includes endpoint when specified with --s3", async () => {
      await init({
        s3: "my-bucket",
        endpoint: "https://custom-endpoint.com",
      });

      expect(saveConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          backendConfig: expect.objectContaining({
            bucket: "my-bucket",
            endpoint: "https://custom-endpoint.com",
          }),
        })
      );
    });
  });

  describe("GCS backend initialization", () => {
    it("initializes with --gcs flag", async () => {
      await init({ gcs: "my-gcs-bucket" });

      expect(saveConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          backend: "s3",
          backendConfig: {
            bucket: "my-gcs-bucket",
            endpoint: "https://storage.googleapis.com",
            region: "auto",
          },
        })
      );
    });
  });

  describe("R2 backend initialization", () => {
    it("initializes with --r2 flag", async () => {
      await init({ r2: "my-r2-bucket" });

      expect(saveConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          backend: "s3",
          backendConfig: expect.objectContaining({
            bucket: "my-r2-bucket",
            region: "auto",
          }),
        })
      );
    });

    it("uses custom endpoint for R2 when provided", async () => {
      await init({
        r2: "my-r2-bucket",
        endpoint: "https://account-id.r2.cloudflarestorage.com",
      });

      expect(saveConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          backendConfig: expect.objectContaining({
            endpoint: "https://account-id.r2.cloudflarestorage.com",
          }),
        })
      );
    });
  });

  describe("interactive mode", () => {
    it("prompts for backend when no flags provided - git", async () => {
      vi.mocked(inquirer.prompt)
        .mockResolvedValueOnce({ backend: "git" })
        .mockResolvedValueOnce({ url: "https://github.com/user/repo" });

      await init({});

      expect(inquirer.prompt).toHaveBeenCalledTimes(2);
      expect(initGitBackend).toHaveBeenCalledWith(
        "https://github.com/user/repo"
      );
    });

    it("prompts for backend when no flags provided - s3", async () => {
      vi.mocked(inquirer.prompt)
        .mockResolvedValueOnce({ backend: "s3" })
        .mockResolvedValueOnce({ bucket: "my-bucket", region: "us-east-1" });

      await init({});

      expect(inquirer.prompt).toHaveBeenCalledTimes(2);
      expect(saveConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          backend: "s3",
          backendConfig: { bucket: "my-bucket", region: "us-east-1" },
        })
      );
    });

    it("prompts for backend when no flags provided - gcs", async () => {
      vi.mocked(inquirer.prompt)
        .mockResolvedValueOnce({ backend: "gcs" })
        .mockResolvedValueOnce({ bucket: "my-gcs-bucket" });

      await init({});

      expect(saveConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          backendConfig: expect.objectContaining({
            bucket: "my-gcs-bucket",
            endpoint: "https://storage.googleapis.com",
          }),
        })
      );
    });

    it("prompts for backend when no flags provided - r2", async () => {
      vi.mocked(inquirer.prompt)
        .mockResolvedValueOnce({ backend: "r2" })
        .mockResolvedValueOnce({ bucket: "my-r2-bucket", accountId: "abc123" });

      await init({});

      expect(saveConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          backendConfig: expect.objectContaining({
            bucket: "my-r2-bucket",
            endpoint: "https://abc123.r2.cloudflarestorage.com",
          }),
        })
      );
    });

    it("prompts for backend when no flags provided - custom s3", async () => {
      vi.mocked(inquirer.prompt)
        .mockResolvedValueOnce({ backend: "s3-custom" })
        .mockResolvedValueOnce({
          bucket: "my-bucket",
          endpoint: "https://minio.local",
          region: "us-east-1",
        });

      await init({});

      expect(saveConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          backendConfig: {
            bucket: "my-bucket",
            endpoint: "https://minio.local",
            region: "us-east-1",
          },
        })
      );
    });
  });

  describe("encryption key generation", () => {
    it("generates and saves encryption key", async () => {
      await init({ git: "https://github.com/user/repo" });

      expect(generateKey).toHaveBeenCalled();
      expect(saveKey).toHaveBeenCalled();
    });

    it("throws error if key generation fails", async () => {
      vi.mocked(generateKey).mockRejectedValueOnce(
        new Error("Key generation failed")
      );

      await expect(
        init({ git: "https://github.com/user/repo" })
      ).rejects.toThrow("Key generation failed");
    });

    it("throws error if key saving fails", async () => {
      vi.mocked(saveKey).mockRejectedValueOnce(new Error("Save failed"));

      await expect(
        init({ git: "https://github.com/user/repo" })
      ).rejects.toThrow("Save failed");
    });
  });

  describe("backend initialization errors", () => {
    it("throws error if git backend init fails", async () => {
      vi.mocked(initGitBackend).mockRejectedValueOnce(
        new Error("Git clone failed")
      );

      await expect(
        init({ git: "https://github.com/user/repo" })
      ).rejects.toThrow("Git clone failed");
    });
  });

  describe("config saving", () => {
    it("saves config with correct structure", async () => {
      await init({ git: "https://github.com/user/repo" });

      expect(saveConfig).toHaveBeenCalledWith({
        backend: "git",
        backendConfig: { url: "https://github.com/user/repo" },
        initialized: true,
        createdAt: expect.any(String),
      });
    });

    it("includes ISO timestamp in createdAt", async () => {
      await init({ git: "https://github.com/user/repo" });

      const savedConfig = vi.mocked(saveConfig).mock.calls[0][0];
      expect(() => new Date(savedConfig.createdAt)).not.toThrow();
    });
  });
});
