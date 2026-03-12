import React from 'react';
import type { EngineState } from '../hooks/useEngine';

interface TopBarProps {
  workspaceName: string | null;
  engineState: EngineState;
  onOpenFolder: () => void;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
}

const ENGINE_DOT_COLOR: Record<EngineState, string> = {
  idle:    '#718096',
  running: '#68d391',
  paused:  '#f6ad55',
  stopped: '#718096',
};

const btnBase: React.CSSProperties = {
  padding: '5px 12px',
  borderRadius: '5px',
  border: '1px solid #2d3748',
  background: '#0f3460',
  color: '#e2e8f0',
  fontSize: '13px',
  cursor: 'pointer',
  fontFamily: 'inherit',
};

const btnSecondary: React.CSSProperties = {
  ...btnBase,
  background: '#2d3748',
};

export default function TopBar({
  workspaceName,
  engineState,
  onOpenFolder,
  onStart,
  onPause,
  onResume,
}: TopBarProps): React.ReactElement {
  const dotColor = ENGINE_DOT_COLOR[engineState];

  return (
    <div
      style={{
        height: '48px',
        display: 'flex',
        alignItems: 'center',
        padding: '0 16px',
        background: '#16213e',
        borderBottom: '1px solid #2d3748',
        gap: '12px',
        flexShrink: 0,
      }}
    >
      {/* Engine state dot */}
      <span
        title={`Engine: ${engineState}`}
        style={{
          width: '10px',
          height: '10px',
          borderRadius: '50%',
          background: dotColor,
          flexShrink: 0,
          boxShadow: engineState === 'running' ? `0 0 6px ${dotColor}` : 'none',
          transition: 'background 0.3s, box-shadow 0.3s',
        }}
      />

      {/* Workspace name */}
      <span
        style={{
          fontSize: '14px',
          fontWeight: 600,
          color: '#e2e8f0',
          flex: 1,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {workspaceName ?? 'No workspace'}
      </span>

      {/* Actions */}
      <button style={btnSecondary} onClick={onOpenFolder}>
        Open Folder
      </button>

      {engineState === 'idle' || engineState === 'stopped' ? (
        <button style={btnBase} onClick={onStart}>
          Start
        </button>
      ) : null}

      {engineState === 'running' ? (
        <button style={btnSecondary} onClick={onPause}>
          Pause
        </button>
      ) : null}

      {engineState === 'paused' ? (
        <button style={btnBase} onClick={onResume}>
          Resume
        </button>
      ) : null}
    </div>
  );
}
