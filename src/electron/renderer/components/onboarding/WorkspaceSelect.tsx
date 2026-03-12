import React, { useState } from 'react';

interface WorkspaceSelectProps {
  onDone: (path: string) => void;
  onSkip: () => void;
}

export default function WorkspaceSelect({ onDone, onSkip }: WorkspaceSelectProps): React.ReactElement {
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleBrowse = async () => {
    setLoading(true);
    try {
      const info: { path: string; name: string } | null = await window.qlaude.workspace.open();
      if (info) {
        setSelectedPath(info.path);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={cardStyle}>
      <h2 style={titleStyle}>Select Workspace</h2>
      <p style={subtitleStyle}>
        Choose the default folder where Claude Code will run. You can change this later.
      </p>

      <div style={{ margin: '24px 0' }}>
        {selectedPath ? (
          <div style={{
            padding: '12px 14px',
            background: '#0d1117',
            borderRadius: '6px',
            border: '1px solid #2d574a',
            fontSize: '13px',
            color: '#68d391',
            fontFamily: 'ui-monospace, "SF Mono", monospace',
            wordBreak: 'break-all',
          }}>
            {selectedPath}
          </div>
        ) : (
          <div style={{
            padding: '24px',
            background: '#0d1117',
            borderRadius: '6px',
            border: '1px dashed #2d3748',
            textAlign: 'center',
            color: '#4a5568',
            fontSize: '13px',
          }}>
            No folder selected
          </div>
        )}

        <button
          onClick={handleBrowse}
          disabled={loading}
          style={{
            ...btnOutline,
            marginTop: '12px',
            opacity: loading ? 0.6 : 1,
          }}
        >
          {loading ? 'Opening...' : selectedPath ? 'Change Folder' : 'Browse...'}
        </button>
      </div>

      <div style={{ display: 'flex', gap: '10px' }}>
        <button onClick={onSkip} style={btnSecondary}>
          Skip for now
        </button>
        <button
          onClick={() => selectedPath && onDone(selectedPath)}
          disabled={!selectedPath}
          style={{ ...btnPrimary, flex: 1, opacity: selectedPath ? 1 : 0.4 }}
        >
          Continue
        </button>
      </div>
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  background: '#16213e',
  borderRadius: '12px',
  border: '1px solid #2d3748',
  padding: '28px',
};

const titleStyle: React.CSSProperties = {
  margin: '0 0 6px',
  fontSize: '18px',
  fontWeight: 600,
  color: '#e2e8f0',
};

const subtitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '13px',
  color: '#718096',
};

const btnPrimary: React.CSSProperties = {
  padding: '10px',
  borderRadius: '6px',
  border: 'none',
  background: '#0f3460',
  color: '#e2e8f0',
  fontSize: '14px',
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'inherit',
};

const btnSecondary: React.CSSProperties = {
  padding: '10px 16px',
  borderRadius: '6px',
  border: '1px solid #2d3748',
  background: 'transparent',
  color: '#718096',
  fontSize: '13px',
  cursor: 'pointer',
  fontFamily: 'inherit',
};

const btnOutline: React.CSSProperties = {
  width: '100%',
  padding: '9px',
  borderRadius: '6px',
  border: '1px solid #2d3748',
  background: 'transparent',
  color: '#a0aec0',
  fontSize: '13px',
  cursor: 'pointer',
  fontFamily: 'inherit',
};
