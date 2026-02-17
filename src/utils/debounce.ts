/**
 * Debounce utility for rate-limiting function calls
 */

/**
 * Creates a debounced version of a function that delays execution
 * until after the specified wait time has elapsed since the last call.
 *
 * @param fn The function to debounce
 * @param waitMs The number of milliseconds to delay
 * @returns A debounced version of the function
 */
export function debounce<T extends (...args: unknown[]) => void>(
  fn: T,
  waitMs: number
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  return (...args: Parameters<T>): void => {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
    timeoutId = setTimeout(() => {
      fn(...args);
      timeoutId = null;
    }, waitMs);
  };
}
