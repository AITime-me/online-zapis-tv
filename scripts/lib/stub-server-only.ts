/**
 * Test-only shim for plain Node/tsx security scripts that import production
 * modules containing `import "server-only"`.
 *
 * Preload: tsx --import ./scripts/lib/stub-server-only.ts <script>
 * Or call installServerOnlyShimForSecurityScripts() before the first
 * server-only import in-process.
 *
 * Never use from production / Client Components.
 */
import { createRequire } from "node:module";
import path from "node:path";

let installed = false;

export function installServerOnlyShimForSecurityScripts(): void {
  if (installed) return;
  const require = createRequire(import.meta.url);
  const serverOnlyMarker = require.resolve("server-only");
  const serverOnlyEmpty = path.join(path.dirname(serverOnlyMarker), "empty.js");
  require(serverOnlyEmpty);
  require.cache[serverOnlyMarker] = require.cache[serverOnlyEmpty];
  installed = true;
}

installServerOnlyShimForSecurityScripts();
