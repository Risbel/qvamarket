// MapLibre GL v6 runs its tile parsing in a module Web Worker that it loads by URL, next to
// its own file. Once Next bundles maplibre-gl that URL no longer exists, so we serve the
// worker (and the module it imports) as static files: public/map/vendor/<version>/.
// Runs before `next dev` and `next build` (see package.json); the output is not committed.
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const pkgPath = require.resolve("maplibre-gl/package.json");
const { version } = JSON.parse(readFileSync(pkgPath, "utf8"));
const from = join(dirname(pkgPath), "dist");
const to = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "map", "vendor", version);

mkdirSync(to, { recursive: true });
for (const file of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) copyFileSync(join(from, file), join(to, file));
console.log(`maplibre-gl ${version} worker -> public/map/vendor/${version}`);
