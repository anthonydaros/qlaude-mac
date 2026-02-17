import { describe, it, expect, beforeEach } from 'vitest';
import { t, setMessageOverrides } from '../../src/utils/telegram-messages.js';

describe('telegram-messages', () => {
  beforeEach(() => {
    // Reset overrides before each test
    setMessageOverrides({});
  });

  describe('t() without overrides', () => {
    it('should return Korean message by default', () => {
      expect(t('notify.selection_prompt', 'ko')).toBe('입력 필요');
    });

    it('should return English message', () => {
      expect(t('notify.selection_prompt', 'en')).toBe('Input Required');
    });

    it('should fall back to Korean for missing English key', () => {
      // Both languages have all keys, but fallback logic is ko → raw key
      expect(t('nonexistent.key', 'en')).toBe('nonexistent.key');
    });

    it('should return raw key for unknown keys', () => {
      expect(t('unknown.key', 'ko')).toBe('unknown.key');
    });

    it('should interpolate parameters', () => {
      const result = t('queue.items', 'ko', { count: 5 });
      expect(result).toBe('📋 큐: 5개 항목');
    });

    it('should interpolate parameters in English', () => {
      const result = t('queue.items', 'en', { count: 3 });
      expect(result).toBe('📋 Queue: 3 items');
    });
  });

  describe('t() with overrides', () => {
    it('should use override over built-in message', () => {
      setMessageOverrides({
        'notify.selection_prompt': '커스텀 제목',
      });

      expect(t('notify.selection_prompt', 'ko')).toBe('커스텀 제목');
      expect(t('notify.selection_prompt', 'en')).toBe('커스텀 제목');
    });

    it('should fall back to built-in for non-overridden keys', () => {
      setMessageOverrides({
        'notify.selection_prompt': '커스텀',
      });

      // Non-overridden key should still return built-in
      expect(t('notify.interrupted', 'ko')).toBe('작업 중단됨');
    });

    it('should support parameter interpolation in overrides', () => {
      setMessageOverrides({
        'queue.items': '대기열: {count}건 남음',
      });

      expect(t('queue.items', 'ko', { count: 7 })).toBe('대기열: 7건 남음');
    });

    it('should allow overriding with empty string', () => {
      setMessageOverrides({
        'notify.selection_prompt': '',
      });

      // Empty string is a valid override (disables the message text)
      expect(t('notify.selection_prompt', 'ko')).toBe('');
    });

    it('should reset overrides when called with empty object', () => {
      setMessageOverrides({
        'notify.selection_prompt': '커스텀',
      });
      expect(t('notify.selection_prompt', 'ko')).toBe('커스텀');

      setMessageOverrides({});
      expect(t('notify.selection_prompt', 'ko')).toBe('입력 필요');
    });
  });
});
