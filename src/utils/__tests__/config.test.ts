import { describe, it, expect, vi, beforeEach } from "vitest";
import path from "path";
import { homedir } from "os";

// Mock fs/promises before importing the module
vi.mock("fs/promises", () => ({
  default: {
    mkdir: vi.fn(),
    writeFile: vi.fn(),
    readFile: vi.fn(),
  },
}));

// Import after mocks are set up
import fs from "fs/promises";
import { saveConfig, loadConfig } from "../config.js";
import type { Config } from "../../backends/index.js";

const CONFIG_DIR = path.join(homedir(), ".claude-sync");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

describe("saveConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset to default successful behavior
    vi.mocked(fs.mkdir).mockResolvedValue(undefined);
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);
  });

  it("creates config directory if it does not exist", async () => {
    const config: Config = {
      backend: "git",
      backendConfig: { url: "https://github.com/user/repo.git" },
      initialized: true,
      createdAt: "2024-01-01T00:00:00.000Z",
    };

    await saveConfig(config);

    expect(fs.mkdir).toHaveBeenCalledWith(CONFIG_DIR, { recursive: true });
  });

  it("writes config as formatted JSON", async () => {
    const config: Config = {
      backend: "git",
      backendConfig: { url: "https://github.com/user/repo.git" },
      initialized: true,
      createdAt: "2024-01-01T00:00:00.000Z",
    };

    await saveConfig(config);

    expect(fs.writeFile).toHaveBeenCalledWith(
      CONFIG_FILE,
      JSON.stringify(config, null, 2)
    );
  });

  it("writes config to correct path", async () => {
    const config: Config = {
      backend: "s3",
      backendConfig: {
        bucket: "my-bucket",
        region: "us-east-1",
      },
      initialized: true,
      createdAt: "2024-01-01T00:00:00.000Z",
    };

    await saveConfig(config);

    expect(fs.writeFile).toHaveBeenCalledWith(CONFIG_FILE, expect.any(String));
  });

  it("preserves all config fields", async () => {
    const config: Config = {
      backend: "git",
      backendConfig: {
        url: "https://github.com/user/repo.git",
        customField: "value",
      },
      initialized: true,
      createdAt: "2024-01-01T00:00:00.000Z",
    };

    await saveConfig(config);

    const writtenContent = vi.mocked(fs.writeFile).mock.calls[0][1] as string;
    const parsed = JSON.parse(writtenContent);

    expect(parsed.backend).toBe("git");
    expect(parsed.backendConfig.url).toBe("https://github.com/user/repo.git");
    expect(parsed.backendConfig.customField).toBe("value");
    expect(parsed.initialized).toBe(true);
    expect(parsed.createdAt).toBe("2024-01-01T00:00:00.000Z");
  });

  it("propagates mkdir errors", async () => {
    vi.mocked(fs.mkdir).mockRejectedValue(new Error("permission denied"));

    const config: Config = {
      backend: "git",
      backendConfig: {},
      initialized: true,
      createdAt: "2024-01-01T00:00:00.000Z",
    };

    await expect(saveConfig(config)).rejects.toThrow("permission denied");
  });

  it("propagates writeFile errors", async () => {
    vi.mocked(fs.writeFile).mockRejectedValue(new Error("disk full"));

    const config: Config = {
      backend: "git",
      backendConfig: {},
      initialized: true,
      createdAt: "2024-01-01T00:00:00.000Z",
    };

    await expect(saveConfig(config)).rejects.toThrow("disk full");
  });
});

describe("loadConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reads config from correct path", async () => {
    const config: Config = {
      backend: "git",
      backendConfig: { url: "https://github.com/user/repo.git" },
      initialized: true,
      createdAt: "2024-01-01T00:00:00.000Z",
    };
    vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(config));

    await loadConfig();

    expect(fs.readFile).toHaveBeenCalledWith(CONFIG_FILE, "utf-8");
  });

  it("parses and returns valid config", async () => {
    const config: Config = {
      backend: "git",
      backendConfig: { url: "https://github.com/user/repo.git" },
      initialized: true,
      createdAt: "2024-01-01T00:00:00.000Z",
    };
    vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(config));

    const result = await loadConfig();

    expect(result).toEqual(config);
  });

  it("returns null when config file does not exist", async () => {
    vi.mocked(fs.readFile).mockRejectedValue(
      Object.assign(new Error("ENOENT"), { code: "ENOENT" })
    );

    const result = await loadConfig();

    expect(result).toBeNull();
  });

  it("returns null when config file is empty", async () => {
    vi.mocked(fs.readFile).mockResolvedValue("");

    const result = await loadConfig();

    // JSON.parse("") throws, so we get null
    expect(result).toBeNull();
  });

  it("returns null for invalid JSON", async () => {
    vi.mocked(fs.readFile).mockResolvedValue("not valid json {{{");

    const result = await loadConfig();

    expect(result).toBeNull();
  });

  it("returns null for any read error", async () => {
    vi.mocked(fs.readFile).mockRejectedValue(new Error("permission denied"));

    const result = await loadConfig();

    expect(result).toBeNull();
  });

  it("loads s3 backend config correctly", async () => {
    const config: Config = {
      backend: "s3",
      backendConfig: {
        bucket: "my-sync-bucket",
        region: "us-west-2",
        prefix: "claude-sessions/",
      },
      initialized: true,
      createdAt: "2024-02-15T12:00:00.000Z",
    };
    vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(config));

    const result = await loadConfig();

    expect(result).toEqual(config);
    expect(result?.backend).toBe("s3");
    expect(result?.backendConfig.bucket).toBe("my-sync-bucket");
  });

  it("handles config with additional fields gracefully", async () => {
    const configWithExtras = {
      backend: "git",
      backendConfig: { url: "https://github.com/user/repo.git" },
      initialized: true,
      createdAt: "2024-01-01T00:00:00.000Z",
      extraField: "should be preserved",
      nested: { data: "value" },
    };
    vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(configWithExtras));

    const result = await loadConfig();

    expect(result).toEqual(configWithExtras);
  });
});

describe("config roundtrip", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fs.mkdir).mockResolvedValue(undefined);
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);
  });

  it("saveConfig then loadConfig returns same data", async () => {
    const originalConfig: Config = {
      backend: "git",
      backendConfig: {
        url: "https://github.com/user/private-repo.git",
        branch: "main",
      },
      initialized: true,
      createdAt: "2024-03-01T08:30:00.000Z",
    };

    // Capture what gets written
    let writtenData = "";
    vi.mocked(fs.writeFile).mockImplementation(async (_, data) => {
      writtenData = data as string;
    });

    await saveConfig(originalConfig);

    // Mock readFile to return what was written
    vi.mocked(fs.readFile).mockResolvedValue(writtenData);

    const loadedConfig = await loadConfig();

    expect(loadedConfig).toEqual(originalConfig);
  });
});

describe("config edge cases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("handles config with special characters in values", async () => {
    const config: Config = {
      backend: "git",
      backendConfig: {
        url: "https://user:p@ss%word@github.com/repo.git",
      },
      initialized: true,
      createdAt: "2024-01-01T00:00:00.000Z",
    };
    vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(config));

    const result = await loadConfig();

    expect(result?.backendConfig.url).toBe(
      "https://user:p@ss%word@github.com/repo.git"
    );
  });

  it("handles config with unicode characters", async () => {
    const config: Config = {
      backend: "git",
      backendConfig: {
        label: "My Sync \u2764\ufe0f \u65e5\u672c\u8a9e",
      },
      initialized: true,
      createdAt: "2024-01-01T00:00:00.000Z",
    };
    vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(config));

    const result = await loadConfig();

    expect(result?.backendConfig.label).toBe(
      "My Sync \u2764\ufe0f \u65e5\u672c\u8a9e"
    );
  });

  it("handles config with empty backendConfig", async () => {
    const config: Config = {
      backend: "git",
      backendConfig: {},
      initialized: false,
      createdAt: "2024-01-01T00:00:00.000Z",
    };
    vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(config));

    const result = await loadConfig();

    expect(result?.backendConfig).toEqual({});
  });

  it("handles initialized: false correctly", async () => {
    const config: Config = {
      backend: "git",
      backendConfig: { url: "https://github.com/user/repo.git" },
      initialized: false,
      createdAt: "2024-01-01T00:00:00.000Z",
    };
    vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(config));

    const result = await loadConfig();

    expect(result?.initialized).toBe(false);
  });
});
