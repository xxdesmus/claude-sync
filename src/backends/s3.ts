import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import type { Backend, RemoteSession } from "./index.js";
import { assertEncrypted } from "../crypto/encrypt.js";

export interface S3Config {
  bucket: string;
  region?: string;
  endpoint?: string; // For GCS, R2, MinIO, etc.
  accessKeyId?: string;
  secretAccessKey?: string;
  prefix?: string; // Optional prefix for all keys
}

const BATCH_SIZE = 50;

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
  const prefix = config.prefix ? `${config.prefix}/` : "sessions/";

  function getKey(sessionId: string): string {
    return `${prefix}${sessionId}.enc`;
  }

  return {
    async push(sessionId: string, encryptedData: Buffer): Promise<void> {
      // Verify data is encrypted before uploading
      assertEncrypted(encryptedData, `session ${sessionId}`);

      await client.send(
        new PutObjectCommand({
          Bucket: config.bucket,
          Key: getKey(sessionId),
          Body: encryptedData,
          ContentType: "application/octet-stream",
        })
      );
    },

    async pushBatch(
      sessions: Array<{ id: string; data: Buffer }>,
      onProgress?: (done: number, total: number) => void
    ): Promise<{ pushed: number; failed: number }> {
      const total = sessions.length;
      let pushed = 0;
      let failed = 0;

      // Process in batches for parallel uploads
      for (let i = 0; i < sessions.length; i += BATCH_SIZE) {
        const batch = sessions.slice(i, i + BATCH_SIZE);

        const results = await Promise.allSettled(
          batch.map(async (session) => {
            // Verify each session is encrypted before uploading
            assertEncrypted(session.data, `session ${session.id}`);

            await client.send(
              new PutObjectCommand({
                Bucket: config.bucket,
                Key: getKey(session.id),
                Body: session.data,
                ContentType: "application/octet-stream",
              })
            );
          })
        );

        for (const result of results) {
          if (result.status === "fulfilled") {
            pushed++;
          } else {
            failed++;
          }
        }

        onProgress?.(pushed + failed, total);
      }

      return { pushed, failed };
    },

    async pull(sessionId: string): Promise<Buffer> {
      const response = await client.send(
        new GetObjectCommand({
          Bucket: config.bucket,
          Key: getKey(sessionId),
        })
      );

      if (!response.Body) {
        throw new Error(`Session ${sessionId} not found`);
      }

      // Convert stream to buffer
      const chunks: Uint8Array[] = [];
      for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
        chunks.push(chunk);
      }
      return Buffer.concat(chunks);
    },

    async list(): Promise<RemoteSession[]> {
      const sessions: RemoteSession[] = [];
      let continuationToken: string | undefined;

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
            const id = obj.Key.replace(prefix, "").replace(".enc", "");
            sessions.push({
              id,
              project: "unknown",
              existsLocally: false,
            });
          }
        }

        continuationToken = response.NextContinuationToken;
      } while (continuationToken);

      return sessions;
    },

    async delete(sessionId: string): Promise<void> {
      await client.send(
        new DeleteObjectCommand({
          Bucket: config.bucket,
          Key: getKey(sessionId),
        })
      );
    },
  };
}
