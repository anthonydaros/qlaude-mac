import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { debounce } from '../../src/utils/debounce.js';

describe('debounce()', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should delay function execution by specified wait time', () => {
    // Given
    const fn = vi.fn();
    const debouncedFn = debounce(fn, 100);

    // When
    debouncedFn();

    // Then - function should not be called immediately
    expect(fn).not.toHaveBeenCalled();

    // When - advance time by 100ms
    vi.advanceTimersByTime(100);

    // Then - function should be called
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should only call function once when called multiple times within wait period', () => {
    // Given
    const fn = vi.fn();
    const debouncedFn = debounce(fn, 100);

    // When - call multiple times rapidly
    debouncedFn();
    vi.advanceTimersByTime(30);
    debouncedFn();
    vi.advanceTimersByTime(30);
    debouncedFn();
    vi.advanceTimersByTime(30);
    debouncedFn();

    // Then - function should not be called yet
    expect(fn).not.toHaveBeenCalled();

    // When - advance time past wait period
    vi.advanceTimersByTime(100);

    // Then - function should be called only once
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should pass arguments to the debounced function', () => {
    // Given
    const fn = vi.fn();
    const debouncedFn = debounce(fn, 100);

    // When
    debouncedFn('arg1', 'arg2');
    vi.advanceTimersByTime(100);

    // Then
    expect(fn).toHaveBeenCalledWith('arg1', 'arg2');
  });

  it('should use the latest arguments when called multiple times', () => {
    // Given
    const fn = vi.fn();
    const debouncedFn = debounce(fn, 100);

    // When - call with different arguments
    debouncedFn('first');
    vi.advanceTimersByTime(50);
    debouncedFn('second');
    vi.advanceTimersByTime(50);
    debouncedFn('third');
    vi.advanceTimersByTime(100);

    // Then - should use the latest arguments
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('third');
  });

  it('should allow multiple calls after wait period expires', () => {
    // Given
    const fn = vi.fn();
    const debouncedFn = debounce(fn, 100);

    // When - first call
    debouncedFn();
    vi.advanceTimersByTime(100);

    // Then
    expect(fn).toHaveBeenCalledTimes(1);

    // When - second call after wait period
    debouncedFn();
    vi.advanceTimersByTime(100);

    // Then
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('should reset timer when called again within wait period', () => {
    // Given
    const fn = vi.fn();
    const debouncedFn = debounce(fn, 100);

    // When - call and advance 80ms
    debouncedFn();
    vi.advanceTimersByTime(80);

    // Then - not called yet
    expect(fn).not.toHaveBeenCalled();

    // When - call again (resets timer)
    debouncedFn();
    vi.advanceTimersByTime(80);

    // Then - still not called (timer was reset)
    expect(fn).not.toHaveBeenCalled();

    // When - advance remaining 20ms
    vi.advanceTimersByTime(20);

    // Then - now called
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
