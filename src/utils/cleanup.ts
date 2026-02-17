/**
 * Cleanup module for graceful shutdown
 * Provides testable cleanup functionality with dependency injection
 */

export interface CleanupDeps {
  isRunning(): boolean;
  kill(): void;
}

export interface StdinLike {
  isTTY?: boolean;
  setRawMode?(mode: boolean): void;
}

export interface DisplayLike {
  clear(): void;
}

/**
 * Creates a cleanup function with injected dependencies
 * Ensures cleanup only runs once (prevents duplicate cleanup)
 */
export function createCleanup(
  ptyWrapper: CleanupDeps,
  display?: DisplayLike,
  stdin: StdinLike = process.stdin
): () => void {
  let isCleaningUp = false;

  return function cleanup(): void {
    if (isCleaningUp) return;
    isCleaningUp = true;

    // Clear status bar first
    display?.clear();

    if (ptyWrapper.isRunning()) {
      ptyWrapper.kill();
    }

    if (stdin.isTTY && stdin.setRawMode) {
      stdin.setRawMode(false);
    }
  };
}
