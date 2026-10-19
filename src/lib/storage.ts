import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "./env";

// Object storage behind a small adapter (ARCHITECTURE decision 2): plain S3, so any regional
// object store can replace the local SeaweedFS. Files are never public; people reach them
// only through short-lived signed URLs issued after a permission check in a service.

/** ARCHITECTURE §5: a signed URL lasts five minutes at most. */
export const SIGNED_URL_TTL_SECONDS = 300;

// Integration tests use the in-memory driver and read stored objects from here.
export const memoryObjects = new Map<string, { bytes: Uint8Array; contentType: string }>();

let client: S3Client | undefined;

function s3() {
  const config = env();
  client ??= new S3Client({
    endpoint: config.S3_ENDPOINT,
    region: config.S3_REGION,
    forcePathStyle: true,
    credentials: {
      accessKeyId: config.S3_ACCESS_KEY_ID,
      secretAccessKey: config.S3_SECRET_ACCESS_KEY,
    },
  });
  return client;
}

/**
 * The key for a tenant's file. Every key starts with the tenant and facility, so a bucket
 * policy or a lifecycle rule can always be scoped to one of them (ARCHITECTURE §5).
 */
export function storageKey(tenantId: string, facilityId: string, ...parts: string[]) {
  return ["tenants", tenantId, "facilities", facilityId, ...parts].join("/");
}

export async function putObject(key: string, bytes: Uint8Array, contentType: string) {
  if (env().STORAGE_DRIVER === "memory") {
    memoryObjects.set(key, { bytes, contentType });
    return;
  }
  await s3().send(
    new PutObjectCommand({
      Bucket: env().S3_BUCKET,
      Key: key,
      Body: bytes,
      ContentType: contentType,
      ServerSideEncryption: "AES256",
    }),
  );
}

export async function deleteObject(key: string) {
  if (env().STORAGE_DRIVER === "memory") {
    memoryObjects.delete(key);
    return;
  }
  await s3().send(new DeleteObjectCommand({ Bucket: env().S3_BUCKET, Key: key }));
}

/**
 * A link that downloads the file under its original name for the next five minutes. Callers
 * must have checked permission first: the link itself carries no identity.
 */
export async function signedDownloadUrl(key: string, fileName: string, contentType: string) {
  const disposition = `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`;
  if (env().STORAGE_DRIVER === "memory") {
    return `memory://${key}?expires=${SIGNED_URL_TTL_SECONDS}`;
  }
  return getSignedUrl(
    s3(),
    new GetObjectCommand({
      Bucket: env().S3_BUCKET,
      Key: key,
      ResponseContentDisposition: disposition,
      ResponseContentType: contentType,
    }),
    { expiresIn: SIGNED_URL_TTL_SECONDS },
  );
}
