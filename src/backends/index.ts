import { createGitBackend } from "./git.js";
import { createS3Backend, type S3Config } from "./s3.js";
import type { ResourceType, RemoteResource } from "../resources/types.js";

export interface RemoteSession {
  id: string;
  project: string;
  existsLocally: boolean;
}

export interface Backend {
  // Legacy session-only methods (for backwards compatibility)
  push(sessionId: string, encryptedData: Buffer): Promise<void>;
  pushBatch(sessions: Array<{ id: string; data: Buffer }>, onProgress?: (done: number, total: number) => void): Promise<{ pushed: number; failed: number }>;
  pull(sessionId: string): Promise<Buffer>;
  list(): Promise<RemoteSession[]>;
  delete(sessionId: string): Promise<void>;

  // Resource-aware methods
  pushResource(
    type: ResourceType,
    id: string,
    encryptedData: Buffer,
    metadata?: Record<string, unknown>
  ): Promise<void>;
  pushResourceBatch(
    type: ResourceType,
    resources: Array<{ id: string; data: Buffer; metadata?: Record<string, unknown> }>,
    onProgress?: (done: number, total: number) => void
  ): Promise<{ pushed: number; failed: number }>;
  pullResource(type: ResourceType, id: string): Promise<Buffer>;
  listResources(type: ResourceType): Promise<RemoteResource[]>;
  deleteResource(type: ResourceType, id: string): Promise<void>;
}

export interface Config {
  backend: "git" | "s3";
  backendConfig: Record<string, string>;
  initialized: boolean;
  createdAt: string;
}

export async function getBackend(config: Config): Promise<Backend> {
  switch (config.backend) {
    case "git":
      return createGitBackend();
    case "s3":
      return createS3Backend(config.backendConfig as unknown as S3Config);
    default:
      throw new Error(`Unknown backend: ${config.backend}`);
  }
}
