import { describe, it, expect, beforeEach } from 'vitest';
import { t, setMessageOverrides } from '../../src/utils/telegram-messages.js';

describe('telegram-messages', () => {
  beforeEach(() => {
    // Reset overrides before each test
    setMessageOverrides({});
  });

  describe('t() without overrides', () => {
    it('should return English message', () => {
      expect(t('notify.selection_prompt')).toBe('Input Required');
    });

    it('should return raw key for unknown keys', () => {
      expect(t('unknown.key')).toBe('unknown.key');
    });

    it('should interpolate parameters', () => {
      const result = t('queue.items', { count: 3 });
      expect(result).toBe('3 items');
    });

    it('should interpolate multiple parameters', () => {
      const result = t('cmd.paused_broadcast', { instanceId: 'host:123' });
      expect(result).toBe('⏸️ Queue paused (host:123)');
    });
  });

  describe('t() with overrides', () => {
    it('should use override over built-in message', () => {
      setMessageOverrides({
        'notify.selection_prompt': 'Custom Title',
      });

      expect(t('notify.selection_prompt')).toBe('Custom Title');
    });

    it('should fall back to built-in for non-overridden keys', () => {
      setMessageOverrides({
        'notify.selection_prompt': 'Custom',
      });

      // Non-overridden key should still return built-in
      expect(t('notify.interrupted')).toBe('Interrupted');
    });

    it('should support parameter interpolation in overrides', () => {
      setMessageOverrides({
        'queue.items': 'Queue: {count} remaining',
      });

      expect(t('queue.items', { count: 7 })).toBe('Queue: 7 remaining');
    });

    it('should allow overriding with empty string', () => {
      setMessageOverrides({
        'notify.selection_prompt': '',
      });

      // Empty string is a valid override (disables the message text)
      expect(t('notify.selection_prompt')).toBe('');
    });

    it('should reset overrides when called with empty object', () => {
      setMessageOverrides({
        'notify.selection_prompt': 'Custom',
      });
      expect(t('notify.selection_prompt')).toBe('Custom');

      setMessageOverrides({});
      expect(t('notify.selection_prompt')).toBe('Input Required');
    });
  });
});
