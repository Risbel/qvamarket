import {
  CreateBucketCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

// S3-compatible object storage (SeaweedFS locally and on the VPS). Config is read
// lazily so `next build` does not need these variables.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/;

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

let client: S3Client | undefined;
function getClient() {
  client ??= new S3Client({
    endpoint: env("S3_ENDPOINT"),
    region: process.env.S3_REGION ?? "us-east-1",
    forcePathStyle: true, // bucket in the path, required by self-hosted S3 servers
    credentials: {
      accessKeyId: env("S3_ACCESS_KEY"),
      secretAccessKey: env("S3_SECRET_KEY"),
    },
  });
  return client;
}

let bucketReady: Promise<void> | undefined;
/** Creates the bucket on first use (idempotent, once per process). */
export function ensureBucket(): Promise<void> {
  bucketReady ??= (async () => {
    const Bucket = env("S3_BUCKET");
    try {
      await getClient().send(new HeadBucketCommand({ Bucket }));
    } catch {
      await getClient().send(new CreateBucketCommand({ Bucket }));
    }
  })().catch((error) => {
    bucketReady = undefined; // retry next time
    throw error;
  });
  return bucketReady;
}

/**
 * Object key under the tenant's own prefix: tenants/<tenantId>/<parts...>.
 * Every stored file must be keyed through this so tenants never share a path.
 */
export function tenantKey(tenantId: string, ...parts: string[]): string {
  if (!UUID.test(tenantId)) throw new Error("Invalid tenant id");
  if (parts.length === 0 || !parts.every((p) => SAFE_SEGMENT.test(p) && p !== "..")) {
    throw new Error("Invalid storage key segment");
  }
  return ["tenants", tenantId, ...parts].join("/");
}

export async function putObject(params: {
  key: string;
  body: Uint8Array;
  contentType: string;
}): Promise<void> {
  await ensureBucket();
  await getClient().send(
    new PutObjectCommand({
      Bucket: env("S3_BUCKET"),
      Key: params.key,
      Body: params.body,
      ContentType: params.contentType,
      // Keys contain a random UUID and are never overwritten: safe to cache forever
      CacheControl: "public, max-age=31536000, immutable",
    }),
  );
}

export async function deleteObject(key: string): Promise<void> {
  await getClient().send(
    new DeleteObjectCommand({ Bucket: env("S3_BUCKET"), Key: key }),
  );
}

/** Public URL of an object (the bucket allows anonymous reads). */
export function publicUrl(key: string): string {
  return `${env("S3_PUBLIC_URL").replace(/\/$/, "")}/${key}`;
}
