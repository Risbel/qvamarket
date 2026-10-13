// Uploads the base map archive (a .pmtiles file, see "Maps" in CLAUDE.md) to the bucket,
// replacing the current one. Run from apps/web with the root .env loaded:
//   node --env-file=../../.env scripts/upload-map.mjs path/to/cuba.pmtiles
import { createReadStream, statSync } from "node:fs";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

const file = process.argv[2];
if (!file) {
  console.error("usage: node --env-file=../../.env scripts/upload-map.mjs <file.pmtiles>");
  process.exit(1);
}
const key = process.env.MAP_ARCHIVE_KEY ?? "platform/maps/cuba.pmtiles";
const client = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION ?? "us-east-1",
  forcePathStyle: true,
  credentials: { accessKeyId: process.env.S3_ACCESS_KEY, secretAccessKey: process.env.S3_SECRET_KEY },
});

const size = statSync(file).size;
await client.send(
  new PutObjectCommand({
    Bucket: process.env.S3_BUCKET,
    Key: key,
    Body: createReadStream(file),
    ContentLength: size,
    ContentType: "application/octet-stream",
  }),
);
console.log(`uploaded ${file} (${(size / 1e6).toFixed(1)} MB) -> ${key}`);
console.log("restart the app (or wait for it to reload) so the tile server reads the new archive");
