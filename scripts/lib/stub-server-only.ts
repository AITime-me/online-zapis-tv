/**
 * Preload for plain Node/tsx security scripts that import server-only modules.
 * Usage: tsx --import ./scripts/lib/stub-server-only.ts <script>
 */
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const serverOnlyMarker = require.resolve("server-only");
const serverOnlyEmpty = path.join(path.dirname(serverOnlyMarker), "empty.js");
require(serverOnlyEmpty);
require.cache[serverOnlyMarker] = require.cache[serverOnlyEmpty];
