/**
 * @fileoverview S3 backend implementation.
 * Stores encrypted resources in S3-compatible storage (AWS S3, GCS, R2, MinIO).
 */

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import type { Backend, RemoteSession } from "./index.js";
import type { ResourceType, RemoteResource } from "../resources/types.js";
import { RESOURCE_CONFIGS } from "../resources/index.js";
import { assertEncrypted } from "../crypto/encrypt.js";

/**
 * Configuration for S3-compatible storage backends.
 * Supports AWS S3, Google Cloud Storage, Cloudflare R2, and MinIO.
 */
export interface S3Config {
  bucket: string;
  region?: string;
  endpoint?: string; // For GCS, R2, MinIO, etc.
  accessKeyId?: string;
  secretAccessKey?: string;
  prefix?: string; // Optional prefix for all keys
}

/** Number of resources to upload in parallel per batch. */
const BATCH_SIZE = 50;

/**
 * Computes the S3 object key for a resource.
 * @param basePrefix - Optional prefix for all keys in the bucket.
 * @param type - The resource type (sessions, agents, settings).
 * @param id - The resource identifier.
 * @returns The S3 object key for the encrypted resource.
 */
function getResourceKey(
  basePrefix: string,
  type: ResourceType,
  id: string
): string {
  const config = RESOURCE_CONFIGS[type];
  // For nested IDs (like skills), replace / with _ to flatten
  const safeId = id.replace(/\//g, "_");
  return `${basePrefix}${config.storagePrefix}${safeId}.enc`;
}

/**
 * Extracts the resource ID from an S3 object key.
 * Reverses the transformation done in getResourceKey.
 * @param key - The full S3 object key.
 * @param prefix - The prefix to remove from the key.
 * @returns The original resource ID.
 */
function parseResourceId(key: string, prefix: string): string {
  // Remove prefix and .enc extension, convert _ back to /
  return key.replace(prefix, "").replace(".enc", "").replace(/_/g, "/");
}

/**
 * Creates an S3-based backend for storing encrypted resources.
 * Compatible with AWS S3, Google Cloud Storage, Cloudflare R2, and MinIO.
 * @param config - S3 configuration including bucket, region, and optional endpoint.
 * @returns A Backend implementation using S3 for storage.
 */
export function createS3Backend(config: S3Config): Backend {
  const clientConfig: ConstructorParameters<typeof S3Client>[0] = {
    region: config.region || "us-east-1",
  };

  // Custom endpoint for GCS, R2, MinIO, etc.
  if (config.endpoint) {
    clientConfig.endpoint = config.endpoint;
    clientConfig.forcePathStyle = true; // Required for most S3-compatible services
  }

  // Explicit credentials (optional - can use env vars or IAM roles)
  if (config.accessKeyId && config.secretAccessKey) {
    clientConfig.credentials = {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    };
  }

  const client = new S3Client(clientConfig);
  const basePrefix = config.prefix ? `${config.prefix}/` : "";

  return {
    // Legacy session-only methods (for backwards compatibility)
    async push(sessionId: string, encryptedData: Buffer): Promise<void> {
      return this.pushResource("sessions", sessionId, encryptedData);
    },

    async pushBatch(
      sessions: Array<{ id: string; data: Buffer }>,
      onProgress?: (done: number, total: number) => void
    ): Promise<{ pushed: number; failed: number }> {
      return this.pushResourceBatch("sessions", sessions, onProgress);
    },

    async pull(sessionId: string): Promise<Buffer> {
      return this.pullResource("sessions", sessionId);
    },

    async list(): Promise<RemoteSession[]> {
      const resources = await this.listResources("sessions");
      return resources.map((r) => ({
        id: r.id,
        project: (r.metadata?.project as string) || "unknown",
        existsLocally: r.existsLocally,
      }));
    },

    async delete(sessionId: string): Promise<void> {
      return this.deleteResource("sessions", sessionId);
    },

    // Resource-aware methods
    async pushResource(
      type: ResourceType,
      id: string,
      encryptedData: Buffer,
      _metadata?: Record<string, unknown>
    ): Promise<void> {
      // Verify data is encrypted before uploading
      assertEncrypted(encryptedData, `${type} ${id}`);

      await client.send(
        new PutObjectCommand({
          Bucket: config.bucket,
          Key: getResourceKey(basePrefix, type, id),
          Body: encryptedData,
          ContentType: "application/octet-stream",
        })
      );
    },

    async pushResourceBatch(
      type: ResourceType,
      resources: Array<{
        id: string;
        data: Buffer;
        metadata?: Record<string, unknown>;
      }>,
      onProgress?: (done: number, total: number) => void
    ): Promise<{
      pushed: number;
      failed: number;
      errors?: Array<{ id: string; error: string }>;
    }> {
      const total = resources.length;
      let pushed = 0;
      let failed = 0;
      const errors: Array<{ id: string; error: string }> = [];

      // Process in batches for parallel uploads
      for (let i = 0; i < resources.length; i += BATCH_SIZE) {
        const batch = resources.slice(i, i + BATCH_SIZE);

        const results = await Promise.allSettled(
          batch.map(async (resource) => {
            // Verify each resource is encrypted before uploading
            assertEncrypted(resource.data, `${type} ${resource.id}`);

            await client.send(
              new PutObjectCommand({
                Bucket: config.bucket,
                Key: getResourceKey(basePrefix, type, resource.id),
                Body: resource.data,
                ContentType: "application/octet-stream",
              })
            );
            return resource.id;
          })
        );

        for (let j = 0; j < results.length; j++) {
          const result = results[j];
          if (result.status === "fulfilled") {
            pushed++;
          } else {
            failed++;
            const resourceId = batch[j].id;
            const errorMessage =
              result.reason instanceof Error
                ? result.reason.message
                : String(result.reason);
            errors.push({ id: resourceId, error: errorMessage });
          }
        }

        onProgress?.(pushed + failed, total);
      }

      return { pushed, failed, errors: errors.length > 0 ? errors : undefined };
    },

    async pullResource(type: ResourceType, id: string): Promise<Buffer> {
      const response = await client.send(
        new GetObjectCommand({
          Bucket: config.bucket,
          Key: getResourceKey(basePrefix, type, id),
        })
      );

      if (!response.Body) {
        throw new Error(`${type} ${id} not found`);
      }

      // Convert stream to buffer
      const chunks: Uint8Array[] = [];
      for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
        chunks.push(chunk);
      }
      return Buffer.concat(chunks);
    },

    async listResources(type: ResourceType): Promise<RemoteResource[]> {
      const resources: RemoteResource[] = [];
      let continuationToken: string | undefined;

      const resourceConfig = RESOURCE_CONFIGS[type];
      const prefix = `${basePrefix}${resourceConfig.storagePrefix}`;

      do {
        const response = await client.send(
          new ListObjectsV2Command({
            Bucket: config.bucket,
            Prefix: prefix,
            ContinuationToken: continuationToken,
          })
        );

        for (const obj of response.Contents || []) {
          if (obj.Key?.endsWith(".enc")) {
            const id = parseResourceId(obj.Key, prefix);
            resources.push({
              id,
              type,
              existsLocally: false, // TODO: Check against local resources
            });
          }
        }

        continuationToken = response.NextContinuationToken;
      } while (continuationToken);

      return resources;
    },

    async deleteResource(type: ResourceType, id: string): Promise<void> {
      await client.send(
        new DeleteObjectCommand({
          Bucket: config.bucket,
          Key: getResourceKey(basePrefix, type, id),
        })
      );
    },
  };
}
