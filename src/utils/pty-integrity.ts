import { createRequire } from 'node:module';
import { existsSync, accessSync, chmodSync, constants } from 'node:fs';
import { join, dirname } from 'node:path';

/**
 * Ensure node-pty's spawn-helper binary has the executable bit set.
 *
 * node-pty@1.1.0 ships spawn-helper without +x on macOS, causing pty.spawn()
 * to fail with EACCES. This function detects and auto-repairs the permission.
 *
 * Checks darwin-arm64 first (primary target), then darwin-x64 as fallback.
 * Throws a descriptive Error if the file is missing or cannot be made executable.
 */
export function ensureSpawnHelper(): void {
  const require = createRequire(import.meta.url);

  let nodePtyMain: string;
  try {
    nodePtyMain = require.resolve('node-pty');
  } catch (err) {
    throw new Error(`Cannot resolve node-pty: ${(err as Error).message}`);
  }

  const nodePtyDir = dirname(nodePtyMain);
  const archs = ['darwin-arm64', 'darwin-x64'];

  for (const arch of archs) {
    const helperPath = join(nodePtyDir, '..', 'prebuilds', arch, 'spawn-helper');

    if (!existsSync(helperPath)) {
      continue;
    }

    try {
      accessSync(helperPath, constants.X_OK);
      return; // Already executable
    } catch {
      // Not executable — attempt to repair
      try {
        chmodSync(helperPath, 0o755);
        return;
      } catch (chmodErr) {
        throw new Error(
          `spawn-helper at ${helperPath} is not executable and chmod failed: ${(chmodErr as Error).message}`
        );
      }
    }
  }

  // No helper found for any supported architecture
  const expectedPath = join(nodePtyDir, '..', 'prebuilds', 'darwin-arm64', 'spawn-helper');
  throw new Error(`node-pty spawn-helper not found. Expected: ${expectedPath}`);
}
