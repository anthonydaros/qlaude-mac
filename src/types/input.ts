/**
 * Command types for input parsing
 * All commands use : prefix and are executed immediately (interactive only)
 */
export type CommandType =
  | 'QUEUE_ADD'           // :add prompt | :add @directive
  | 'QUEUE_REMOVE'        // :drop
  | 'QUEUE_SAVE_SESSION'  // :save name (immediate)
  | 'QUEUE_LOAD_SESSION'  // :load name (immediate)
  | 'QUEUE_CLEAR'         // :clear
  | 'META_RELOAD'         // :reload
  | 'META_STATUS'         // :status
  | 'META_PAUSE'          // :pause
  | 'META_RESUME'         // :resume
  | 'META_HELP'           // :help
  | 'META_LIST'           // :list
  | 'META_MODEL'          // :model name (immediate model switch)
  | 'PASSTHROUGH';        // Regular input

/**
 * Result of parsing user input
 */
export interface ParseResult {
  type: CommandType;
  prompt?: string;
  label?: string;  // For Save/Load commands
  rawInput: string;
}
