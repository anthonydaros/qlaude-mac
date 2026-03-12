import React from 'react';

interface ReviewStepProps {
  telegramToken: string;
  telegramChatId: string;
  workspacePath: string;
  onComplete: () => void;
}

export default function ReviewStep({
  telegramToken,
  telegramChatId,
  workspacePath,
  onComplete,
}: ReviewStepProps): React.ReactElement {
  return (
    <div style={cardStyle}>
      <h2 style={titleStyle}>Ready to go!</h2>
      <p style={subtitleStyle}>
        Here's a summary of your setup. Click Launch to start using qlaude Desktop.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', margin: '24px 0' }}>
        <ReviewRow
          icon="🤖"
          label="Telegram Bot"
          value={telegramToken ? `Connected (token: ${telegramToken.slice(0, 8)}...)` : 'Not configured'}
          ok={!!telegramToken}
        />
        <ReviewRow
          icon="💬"
          label="Chat ID"
          value={telegramChatId || 'Not detected'}
          ok={!!telegramChatId}
        />
        <ReviewRow
          icon="📁"
          label="Workspace"
          value={workspacePath || 'Not selected (you can set this later)'}
          ok={!!workspacePath}
        />
      </div>

      <button onClick={onComplete} style={btnPrimary}>
        Launch qlaude Desktop
      </button>
    </div>
  );
}

function ReviewRow({
  icon,
  label,
  value,
  ok,
}: {
  icon: string;
  label: string;
  value: string;
  ok: boolean;
}): React.ReactElement {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'flex-start',
      gap: '12px',
      padding: '12px',
      background: '#0d1117',
      borderRadius: '6px',
      border: `1px solid ${ok ? '#2d574a' : '#2d3748'}`,
    }}>
      <span style={{ fontSize: '16px', flexShrink: 0, marginTop: '1px' }}>{icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '11px', color: '#718096', marginBottom: '2px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          {label}
        </div>
        <div style={{
          fontSize: '12px',
          color: ok ? '#68d391' : '#a0aec0',
          fontFamily: 'ui-monospace, "SF Mono", monospace',
          wordBreak: 'break-all',
        }}>
          {value}
        </div>
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
  width: '100%',
  padding: '12px',
  borderRadius: '6px',
  border: 'none',
  background: '#0f3460',
  color: '#e2e8f0',
  fontSize: '15px',
  fontWeight: 700,
  cursor: 'pointer',
  fontFamily: 'inherit',
  letterSpacing: '0.01em',
};
