import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueueManager } from '../../src/queue-manager.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

// Only suppress logger noise — no fs mock, real file I/O
vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

/**
 * Comprehensive queue file parsing test — real file I/O, no mocks.
 *
 * Writes an actual queue file to a temp directory, lets QueueManager
 * read it via the real filesystem, then verifies every parsed item.
 */
describe('Queue file comprehensive parsing (real I/O)', () => {
  let tmpDir: string;
  let queueFilePath: string;
  let queueManager: QueueManager;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'qlaude-test-'));
    queueFilePath = path.join(tmpDir, 'queue');
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // ────────────────────────────────────────────────────────────
  // Helper: write content to queue file, create QueueManager, reload
  // ────────────────────────────────────────────────────────────
  async function loadQueue(content: string) {
    await fs.writeFile(queueFilePath, content, 'utf-8');
    queueManager = new QueueManager(queueFilePath);
    return queueManager.reload();
  }

  // ────────────────────────────────────────────────────────────
  // The queue file content under test.
  // Line numbers in comments are QUEUE FILE line numbers (1-based).
  // Item indices in brackets [N] are expected parse result indices (0-based).
  // ────────────────────────────────────────────────────────────
  const QUEUE_FILE = [
    // === Section 1: Basic prompts ===
    'Simple prompt',                         // L1  → [0] bare text
    '  Indented prompt  ',                   // L2  → [1] whitespace trimmed

    // === Section 2: Skip rules ===
    '',                                      // L3  skipped: empty line
    '   ',                                   // L4  skipped: whitespace-only
    '# This is a comment',                   // L5  skipped: comment
    '  # Indented comment',                  // L6  skipped: indented comment

    // === Section 3: @ directives ===
    '@new',                                  // L7  → [2] new session
    '@pause Check results here',             // L8  → [3] breakpoint with reason
    '@pause',                                // L9  → [4] breakpoint without reason
    '@save my-checkpoint',                   // L10 → [5] save session
    '@load my-checkpoint',                   // L11 → [6] load session

    // === Section 4: Directive case-insensitivity ===
    '@NEW',                                  // L12 → [7] uppercase → new session
    '@Pause Mixed Case Reason',              // L13 → [8] mixed case → breakpoint
    '@SAVE UPPER',                           // L14 → [9] uppercase → save
    '@LOAD upper-label',                     // L15 → [10] uppercase → load

    // === Section 5: Directive args with extra spaces ===
    '@pause   lots   of   spaces   ',        // L16 → [11] args trimmed
    '@save   spaced-name  ',                 // L17 → [12] name trimmed

    // === Section 6: Directives without required args (silently consumed, no item) ===
    '@save',                                 // L18 no item: @save with no name
    '@save   ',                              // L19 no item: @save with only whitespace
    '@load',                                 // L20 no item: @load with no name
    '@load   ',                              // L21 no item: @load with only whitespace

    // === Section 7: Escape sequences ===
    '\\@username mentioned this',            // L22 → [13] \@ → prompt "@username mentioned this"
    '\\\\@doubly escaped',                   // L23 → [14] \\@ → prompt "\@doubly escaped"
    '\\@new',                                // L24 → [15] \@new → prompt "@new" (NOT a directive)
    '\\@pause not a directive',              // L25 → [16] \@pause → prompt (NOT a breakpoint)

    // === Section 8: Unknown @ directives → bare prompts ===
    '@unknown something',                    // L26 → [17] unknown → bare prompt
    '@',                                     // L27 → [18] bare @ → bare prompt
    '@123numeric',                           // L28 → [19] numeric → bare prompt

    // === Section 9: Interactive-only directives → bare prompts ===
    '@add something',                        // L29 → [20]
    '@drop',                                 // L30 → [21]
    '@clear',                                // L31 → [22]
    '@resume',                               // L32 → [23]
    '@reload',                               // L33 → [24]
    '@status',                               // L34 → [25]
    '@help',                                 // L35 → [26]
    '@list',                                 // L36 → [27]

    // === Section 10: : prefix → NOT parsed (bare prompts) ===
    ':add something',                        // L37 → [28]
    ':new',                                  // L38 → [29]
    ':pause',                                // L39 → [30]

    // === Section 11: Basic multiline ===
    '@(',                                    // L40 → [31] start
    'First line of multiline',               // L41   content
    'Second line of multiline',              // L42   content
    '@)',                                    // L43   end

    // === Section 12: Multiline preserves formatting ===
    '@(',                                    // L44 → [32] start
    '  Indented line',                       // L45   preserved (not trimmed)
    '',                                      // L46   empty line preserved
    '  Another indented line',               // L47   preserved
    '@)',                                    // L48   end

    // === Section 13: Traps inside multiline ===
    '@(',                                    // L49 → [33] start
    '@new',                                  // L50   literal text
    '@pause this is text',                   // L51   literal text
    '#not a comment inside multiline',       // L52   literal text
    '@(',                                    // L53   literal text (NOT nested)
    '\\@not escaped inside multiline',       // L54   literal text (NOT escape)
    '@)',                                    // L55   end

    // === Section 14: Empty multiline block ===
    '@(',                                    // L56 → [34] start
    '@)',                                    // L57   end → empty prompt

    // === Section 15: @new + @( multiline (separate items) ===
    '@new',                                  // L58 → [35] new session (standalone)
    '@(',                                    // L59 → [36] multiline (separate item)
    'Prompt in new session',                 // L60   content
    'Second line',                           // L61   content
    '@)',                                    // L62   end

    // === Section 16: @) with trailing text ≠ close ===
    '@(',                                    // L63 → [37] start
    'Before closing',                        // L64   content
    '@) this is not a close',                // L65   NOT a close
    'After fake close',                      // L66   still inside
    '@)',                                    // L67   real close

    // === Section 17: @new( is NOT special ===
    '@new(',                                 // L68 → [38] bare prompt

    // === Section 18: @ in middle of text ===
    'Tell me about @new features',           // L69 → [39]
    'Use the @pause command wisely',         // L70 → [40]
    'Email user@example.com please',         // L71 → [41]

    // === Section 19: Multiple consecutive @new ===
    '@new',                                  // L72 → [42]
    '@new',                                  // L73 → [43]
    '@new',                                  // L74 → [44]

    // === Section 20: Realistic sequence ===
    'Implement feature X',                   // L75 → [45]
    '@pause Review feature X implementation', // L76 → [46]
    '@save feature-x-done',                  // L77 → [47]
    '@new',                                  // L78 → [48]
    '@load feature-x-done',                  // L79 → [49]
    'Continue from saved checkpoint',        // L80 → [50]

    // === Section 21: @model directive ===
    '@model opus',                           // L81 → [52] model switch
    '@model sonnet-4',                       // L82 → [53] model with hyphen
    '@MODEL OPUS',                           // L83 → [54] case-insensitive directive
    '@model   spaced-name  ',                // L84 → [55] args trimmed
    '@model',                                // L85 no item: @model with no name (silently skipped)
    '@model   ',                             // L86 no item: @model with only whitespace (skipped)

    // === Section 22: @delay directive ===
    '@delay 1000',                           // L87 → [55] delay 1 second
    '@delay 500',                            // L88 → [56] delay 500ms
    '@DELAY 2000',                           // L89 → [57] case-insensitive
    '@delay',                                // L90 no item: no args (skipped)
    '@delay abc',                            // L91 no item: non-numeric (skipped)
    '@delay 0',                              // L92 no item: zero (skipped)
    '@delay -100',                           // L93 no item: negative (skipped)

    // === Section 23: Final ===
    'Final prompt',                          // L94 → [58]
  ].join('\n');

  // ────────────────────────────────────────────────────────────
  // Master test: load QUEUE_FILE, assert total counts
  // ────────────────────────────────────────────────────────────
  it('should parse correct total item count and skip count', async () => {
    const result = await loadQueue(QUEUE_FILE);

    expect(result.fileFound).toBe(true);
    expect(result.itemCount).toBe(59);
    // Skipped = 2 empty/whitespace lines + 2 comments = 4
    // (@save/@load without args: consumed but not counted as skipped)
    expect(result.skippedLines).toBe(4);
  });

  // ────────────────────────────────────────────────────────────
  // Per-item verification
  // ────────────────────────────────────────────────────────────
  describe('Every parsed item', () => {
    // Expected shape of each item — only include fields we care about.
    // Fields not listed are implicitly "don't care" (except where explicitly checked).
    type E = {
      prompt: string;
      isNewSession: boolean;
      isBreakpoint?: true;
      labelSession?: string;
      loadSessionLabel?: string;
      isMultiline?: true;
      modelName?: string;
      delayMs?: number;
    };

    const expected: E[] = [
      /* [0]  */ { prompt: 'Simple prompt', isNewSession: false },
      /* [1]  */ { prompt: 'Indented prompt', isNewSession: false },
      /* [2]  */ { prompt: '', isNewSession: true },
      /* [3]  */ { prompt: 'Check results here', isNewSession: false, isBreakpoint: true },
      /* [4]  */ { prompt: '', isNewSession: false, isBreakpoint: true },
      /* [5]  */ { prompt: '', isNewSession: false, labelSession: 'my-checkpoint' },
      /* [6]  */ { prompt: '', isNewSession: true, loadSessionLabel: 'my-checkpoint' },
      /* [7]  */ { prompt: '', isNewSession: true },                          // @NEW
      /* [8]  */ { prompt: 'Mixed Case Reason', isNewSession: false, isBreakpoint: true }, // @Pause
      /* [9]  */ { prompt: '', isNewSession: false, labelSession: 'UPPER' },  // @SAVE
      /* [10] */ { prompt: '', isNewSession: true, loadSessionLabel: 'upper-label' }, // @LOAD
      /* [11] */ { prompt: 'lots   of   spaces', isNewSession: false, isBreakpoint: true },
      /* [12] */ { prompt: '', isNewSession: false, labelSession: 'spaced-name' },
      /* [13] */ { prompt: '@username mentioned this', isNewSession: false },  // \@ escape
      /* [14] */ { prompt: '\\@doubly escaped', isNewSession: false },         // \\@ escape
      /* [15] */ { prompt: '@new', isNewSession: false },                      // \@new → NOT directive
      /* [16] */ { prompt: '@pause not a directive', isNewSession: false },     // \@pause → NOT breakpoint
      /* [17] */ { prompt: '@unknown something', isNewSession: false },
      /* [18] */ { prompt: '@', isNewSession: false },
      /* [19] */ { prompt: '@123numeric', isNewSession: false },
      /* [20] */ { prompt: '@add something', isNewSession: false },
      /* [21] */ { prompt: '@drop', isNewSession: false },
      /* [22] */ { prompt: '@clear', isNewSession: false },
      /* [23] */ { prompt: '@resume', isNewSession: false },
      /* [24] */ { prompt: '@reload', isNewSession: false },
      /* [25] */ { prompt: '@status', isNewSession: false },
      /* [26] */ { prompt: '@help', isNewSession: false },
      /* [27] */ { prompt: '@list', isNewSession: false },
      /* [28] */ { prompt: ':add something', isNewSession: false },
      /* [29] */ { prompt: ':new', isNewSession: false },
      /* [30] */ { prompt: ':pause', isNewSession: false },
      /* [31] */ { prompt: 'First line of multiline\nSecond line of multiline', isNewSession: false, isMultiline: true },
      /* [32] */ { prompt: '  Indented line\n\n  Another indented line', isNewSession: false, isMultiline: true },
      /* [33] */ { prompt: '@new\n@pause this is text\n#not a comment inside multiline\n@(\n\\@not escaped inside multiline', isNewSession: false, isMultiline: true },
      /* [34] */ { prompt: '', isNewSession: false, isMultiline: true },        // empty multiline
      /* [35] */ { prompt: '', isNewSession: true },                           // @new (standalone)
      /* [36] */ { prompt: 'Prompt in new session\nSecond line', isNewSession: false, isMultiline: true },
      /* [37] */ { prompt: 'Before closing\n@) this is not a close\nAfter fake close', isNewSession: false, isMultiline: true },
      /* [38] */ { prompt: '@new(', isNewSession: false },                     // NOT multiline
      /* [39] */ { prompt: 'Tell me about @new features', isNewSession: false },
      /* [40] */ { prompt: 'Use the @pause command wisely', isNewSession: false },
      /* [41] */ { prompt: 'Email user@example.com please', isNewSession: false },
      /* [42] */ { prompt: '', isNewSession: true },
      /* [43] */ { prompt: '', isNewSession: true },
      /* [44] */ { prompt: '', isNewSession: true },
      /* [45] */ { prompt: 'Implement feature X', isNewSession: false },
      /* [46] */ { prompt: 'Review feature X implementation', isNewSession: false, isBreakpoint: true },
      /* [47] */ { prompt: '', isNewSession: false, labelSession: 'feature-x-done' },
      /* [48] */ { prompt: '', isNewSession: true },
      /* [49] */ { prompt: '', isNewSession: true, loadSessionLabel: 'feature-x-done' },
      /* [50] */ { prompt: 'Continue from saved checkpoint', isNewSession: false },
      /* [51] */ { prompt: '/model opus', isNewSession: false, modelName: 'opus' },
      /* [52] */ { prompt: '/model sonnet-4', isNewSession: false, modelName: 'sonnet-4' },
      /* [53] */ { prompt: '/model OPUS', isNewSession: false, modelName: 'OPUS' },
      /* [54] */ { prompt: '/model spaced-name', isNewSession: false, modelName: 'spaced-name' },
      /* [55] */ { prompt: '', isNewSession: false, delayMs: 1000 },
      /* [56] */ { prompt: '', isNewSession: false, delayMs: 500 },
      /* [57] */ { prompt: '', isNewSession: false, delayMs: 2000 },
      /* [58] */ { prompt: 'Final prompt', isNewSession: false },
    ];

    beforeEach(async () => {
      await loadQueue(QUEUE_FILE);
    });

    it(`should produce exactly ${expected.length} items`, () => {
      expect(queueManager.getItems()).toHaveLength(expected.length);
    });

    // Generate one test per item for clear failure messages
    expected.forEach((exp, i) => {
      it(`[${i}] prompt=${JSON.stringify(exp.prompt).slice(0, 50)}`, () => {
        const item = queueManager.getItems()[i];
        expect(item.prompt).toBe(exp.prompt);
        expect(item.isNewSession).toBe(exp.isNewSession);

        if (exp.isBreakpoint) {
          expect(item.isBreakpoint).toBe(true);
        } else {
          expect(item.isBreakpoint).toBeFalsy();
        }

        if (exp.labelSession) {
          expect(item.labelSession).toBe(exp.labelSession);
        } else {
          expect(item.labelSession).toBeUndefined();
        }

        if (exp.loadSessionLabel) {
          expect(item.loadSessionLabel).toBe(exp.loadSessionLabel);
        } else {
          expect(item.loadSessionLabel).toBeUndefined();
        }

        if (exp.isMultiline) {
          expect(item.isMultiline).toBe(true);
        } else {
          expect(item.isMultiline).toBeFalsy();
        }

        if (exp.modelName !== undefined) {
          expect(item.modelName).toBe(exp.modelName);
        } else {
          expect(item.modelName).toBeUndefined();
        }

        if (exp.delayMs !== undefined) {
          expect(item.delayMs).toBe(exp.delayMs);
        } else {
          expect(item.delayMs).toBeUndefined();
        }
      });
    });
  });

  // ────────────────────────────────────────────────────────────
  // Standalone edge cases (each with its own queue file)
  // ────────────────────────────────────────────────────────────

  describe('Edge: unclosed multiline block', () => {
    it('should gracefully collect lines without @)', async () => {
      await loadQueue('@(\nline1\nline2');
      const items = queueManager.getItems();
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({ isMultiline: true, prompt: 'line1\nline2' });
    });

    it('should handle unclosed block after normal items', async () => {
      await loadQueue('prompt1\n@(\norphan');
      const items = queueManager.getItems();
      expect(items).toHaveLength(2);
      expect(items[0].prompt).toBe('prompt1');
      expect(items[1]).toMatchObject({ isMultiline: true, prompt: 'orphan' });
    });
  });

  describe('Edge: empty / blank file', () => {
    it('empty file → 0 items', async () => {
      const result = await loadQueue('');
      expect(result.itemCount).toBe(0);
    });

    it('only whitespace and comments → 0 items', async () => {
      const result = await loadQueue('  \n# comment\n\n# another\n  ');
      expect(result.itemCount).toBe(0);
    });
  });

  describe('Edge: @( / @) with surrounding whitespace', () => {
    it('should recognize trimmed @( and @)', async () => {
      await loadQueue('  @(  \ncontent\n  @)  ');
      const items = queueManager.getItems();
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({ isMultiline: true, prompt: 'content' });
    });
  });

  describe('Edge: consecutive multiline blocks', () => {
    it('should parse as separate items', async () => {
      await loadQueue('@(\nblock1\n@)\n@(\nblock2\n@)');
      const items = queueManager.getItems();
      expect(items).toHaveLength(2);
      expect(items[0].prompt).toBe('block1');
      expect(items[1].prompt).toBe('block2');
    });
  });

  // ────────────────────────────────────────────────────────────
  // Roundtrip: parse → serialize → parse (real I/O both times)
  // ────────────────────────────────────────────────────────────
  describe('Roundtrip: write → read → serialize → read again', () => {
    it('should produce identical items after serialize → reparse', async () => {
      // Phase 1: parse original file
      await loadQueue(QUEUE_FILE);
      const original = queueManager.getItems();

      // Phase 2: serialize by adding all items to a fresh QueueManager
      const roundtripPath = path.join(tmpDir, 'queue-roundtrip');
      await fs.writeFile(roundtripPath, '', 'utf-8');
      const qm2 = new QueueManager(roundtripPath);

      for (const item of original) {
        await qm2.addItem(item.prompt, {
          isNewSession: item.isNewSession,
          isBreakpoint: item.isBreakpoint,
          labelSession: item.labelSession,
          loadSessionLabel: item.loadSessionLabel,
          isMultiline: item.isMultiline,
          modelName: item.modelName,
          delayMs: item.delayMs,
        });
      }

      // Phase 3: read the serialized file with a third QueueManager
      const qm3 = new QueueManager(roundtripPath);
      await qm3.reload();
      const reparsed = qm3.getItems();

      expect(reparsed).toHaveLength(original.length);

      for (let i = 0; i < original.length; i++) {
        const o = original[i];
        const r = reparsed[i];

        expect(r.prompt).toBe(o.prompt);
        expect(r.isNewSession).toBe(o.isNewSession);
        expect(r.isBreakpoint).toBe(o.isBreakpoint);
        expect(r.labelSession).toBe(o.labelSession);
        expect(r.loadSessionLabel).toBe(o.loadSessionLabel);
        expect(r.modelName).toBe(o.modelName);
        expect(r.delayMs).toBe(o.delayMs);

        // Multiline flag is preserved for prompts that actually span lines
        if (o.isMultiline && o.prompt.includes('\n')) {
          expect(r.isMultiline).toBe(true);
        }
      }
    });
  });

  // ────────────────────────────────────────────────────────────
  // Windows \r\n line endings
  // ────────────────────────────────────────────────────────────
  describe('Edge: Windows \\r\\n line endings', () => {
    it('should handle \\r\\n in basic prompts', async () => {
      await loadQueue('prompt1\r\nprompt2\r\nprompt3');
      const items = queueManager.getItems();
      expect(items).toHaveLength(3);
      expect(items[0].prompt).toBe('prompt1');
      expect(items[1].prompt).toBe('prompt2');
      expect(items[2].prompt).toBe('prompt3');
    });

    it('should handle \\r\\n in multiline blocks (no stray \\r)', async () => {
      await loadQueue('@(\r\n  Indented line\r\n\r\n  Another line\r\n@)');
      const items = queueManager.getItems();
      expect(items).toHaveLength(1);
      expect(items[0].isMultiline).toBe(true);
      // Critical: no \r characters in the content
      expect(items[0].prompt).toBe('  Indented line\n\n  Another line');
      expect(items[0].prompt).not.toContain('\r');
    });

    it('should handle \\r\\n in directives', async () => {
      await loadQueue('@new\r\n@pause Check here\r\n@save cp1\r\n@load cp1');
      const items = queueManager.getItems();
      expect(items).toHaveLength(4);
      expect(items[0].isNewSession).toBe(true);
      expect(items[1].isBreakpoint).toBe(true);
      expect(items[1].prompt).toBe('Check here');
      expect(items[2].labelSession).toBe('cp1');
      expect(items[3].loadSessionLabel).toBe('cp1');
    });

    it('should handle \\r\\n in escape sequences', async () => {
      await loadQueue('\\@escaped\r\n\\\\@double');
      const items = queueManager.getItems();
      expect(items[0].prompt).toBe('@escaped');
      expect(items[1].prompt).toBe('\\@double');
    });

    it('should handle mixed \\n and \\r\\n in same file', async () => {
      await loadQueue('prompt1\nprompt2\r\n@(\nline1\r\nline2\n@)\r\nprompt3');
      const items = queueManager.getItems();
      expect(items).toHaveLength(4);
      expect(items[0].prompt).toBe('prompt1');
      expect(items[1].prompt).toBe('prompt2');
      expect(items[2].prompt).toBe('line1\nline2');
      expect(items[2].prompt).not.toContain('\r');
      expect(items[3].prompt).toBe('prompt3');
    });

    it('full queue file with \\r\\n should produce same results as \\n', async () => {
      // Parse with \n
      await loadQueue(QUEUE_FILE);
      const lfItems = queueManager.getItems();

      // Parse with \r\n
      const crlfContent = QUEUE_FILE.replace(/\n/g, '\r\n');
      await loadQueue(crlfContent);
      const crlfItems = queueManager.getItems();

      expect(crlfItems).toHaveLength(lfItems.length);
      for (let i = 0; i < lfItems.length; i++) {
        expect(crlfItems[i].prompt).toBe(lfItems[i].prompt);
        expect(crlfItems[i].isNewSession).toBe(lfItems[i].isNewSession);
        expect(crlfItems[i].isBreakpoint).toBe(lfItems[i].isBreakpoint);
        expect(crlfItems[i].labelSession).toBe(lfItems[i].labelSession);
        expect(crlfItems[i].loadSessionLabel).toBe(lfItems[i].loadSessionLabel);
        expect(crlfItems[i].isMultiline).toBe(lfItems[i].isMultiline);
      }
    });
  });
});
