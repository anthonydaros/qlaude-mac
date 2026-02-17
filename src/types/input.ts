/**
 * Command types for input parsing
 */
export type CommandType =
  | 'QUEUE_ADD'           // >>
  | 'QUEUE_REMOVE'        // <<
  | 'QUEUE_NEW_SESSION'   // >>>
  | 'QUEUE_BREAKPOINT'    // >>#
  | 'QUEUE_LABEL_SESSION' // >>{Label:name}
  | 'QUEUE_LOAD_SESSION'  // >>{Load:name}
  | 'META_RELOAD'         // :reload
  | 'META_STATUS'         // :status
  | 'META_PAUSE'          // :pause
  | 'META_RESUME'         // :resume
  | 'PASSTHROUGH';        // Regular input

/**
 * Result of parsing user input
 */
export interface ParseResult {
  type: CommandType;
  prompt?: string;
  label?: string;  // For Label/Load commands
  rawInput: string;
}
