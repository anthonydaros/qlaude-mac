import React, { useEffect } from 'react';
import '@xterm/xterm/css/xterm.css';
import { useTerminal } from '../hooks/useTerminal';

interface TerminalViewProps {
  /** When the panel containing this view is resized, pass a resize token to trigger fit(). */
  resizeToken?: unknown;
}

export default function TerminalView({ resizeToken }: TerminalViewProps): React.ReactElement {
  const { containerRef, clear, fit } = useTerminal();

  // Re-fit whenever the parent layout changes (e.g. TaskDetail panel opens/closes)
  useEffect(() => {
    fit();
  }, [resizeToken, fit]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#0d1117' }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '0 10px',
          height: '30px',
          borderBottom: '1px solid #1a2332',
          flexShrink: 0,
          gap: '6px',
        }}
      >
        <span
          style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            background: '#68d391',
            flexShrink: 0,
          }}
        />
        <span style={{ fontSize: '11px', color: '#4a5568', flex: 1, letterSpacing: '0.04em' }}>
          PTY OUTPUT
        </span>
        <button
          onClick={clear}
          title="Clear terminal"
          style={{
            background: 'transparent',
            border: 'none',
            color: '#4a5568',
            fontSize: '11px',
            cursor: 'pointer',
            padding: '2px 6px',
            borderRadius: '3px',
            fontFamily: 'inherit',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = '#718096')}
          onMouseLeave={(e) => (e.currentTarget.style.color = '#4a5568')}
        >
          clear
        </button>
      </div>

      {/* xterm container */}
      <div
        ref={containerRef}
        style={{
          flex: 1,
          overflow: 'hidden',
          padding: '4px',
        }}
      />
    </div>
  );
}
