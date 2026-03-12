import { useEffect, useRef, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';

const XTERM_THEME = {
  background: '#0d1117',
  foreground: '#e2e8f0',
  cursor: '#e2e8f0',
  selectionBackground: '#2d3748',
  black: '#1a1a2e',
  brightBlack: '#4a5568',
  red: '#fc8181',
  brightRed: '#feb2b2',
  green: '#68d391',
  brightGreen: '#9ae6b4',
  yellow: '#f6e05e',
  brightYellow: '#faf089',
  blue: '#63b3ed',
  brightBlue: '#90cdf4',
  magenta: '#b794f4',
  brightMagenta: '#d6bcfa',
  cyan: '#76e4f7',
  brightCyan: '#9decf9',
  white: '#e2e8f0',
  brightWhite: '#f7fafc',
};

export interface UseTerminalResult {
  containerRef: React.RefObject<HTMLDivElement | null>;
  clear: () => void;
  fit: () => void;
}

export function useTerminal(): UseTerminalResult {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const terminal = new Terminal({
      convertEol: true,
      scrollback: 5000,
      theme: XTERM_THEME,
      fontFamily: 'ui-monospace, "SF Mono", "Cascadia Code", monospace',
      fontSize: 12,
      lineHeight: 1.4,
      cursorBlink: false,
      disableStdin: true,
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(containerRef.current);

    const safeFit = () => {
      if (containerRef.current && containerRef.current.offsetParent !== null) {
        fitAddon.fit();
      }
    };
    safeFit();

    termRef.current = terminal;
    fitAddonRef.current = fitAddon;

    const ro = new ResizeObserver(safeFit);
    ro.observe(containerRef.current);

    const unsubscribe = window.qlaude.execution.subscribe((data: string) => {
      terminal.write(data);
    });

    return () => {
      unsubscribe();
      ro.disconnect();
      terminal.dispose();
      termRef.current = null;
      fitAddonRef.current = null;
    };
  }, []);

  const clear = useCallback(() => {
    termRef.current?.clear();
  }, []);

  const fit = useCallback(() => {
    if (containerRef.current && containerRef.current.offsetParent !== null) {
      fitAddonRef.current?.fit();
    }
  }, []);

  return { containerRef, clear, fit };
}
