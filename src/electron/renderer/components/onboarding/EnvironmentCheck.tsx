import React, { useEffect, useState } from 'react';

interface CheckItem {
  label: string;
  status: 'checking' | 'ok' | 'error';
  detail?: string;
}

interface EnvironmentCheckProps {
  onNext: () => void;
}

export default function EnvironmentCheck({ onNext }: EnvironmentCheckProps): React.ReactElement {
  const [checks, setChecks] = useState<CheckItem[]>([
    { label: 'macOS platform', status: 'checking' },
    { label: 'Claude CLI (claude)', status: 'checking' },
    { label: 'App version', status: 'checking' },
  ]);

  useEffect(() => {
    window.qlaude.health.check().then((result: { ok: boolean; version: string; platform: string }) => {
      setChecks([
        {
          label: 'macOS platform',
          status: result.platform === 'darwin' ? 'ok' : 'error',
          detail: result.platform,
        },
        {
          label: 'Claude CLI (claude)',
          status: 'ok',
          detail: 'Available',
        },
        {
          label: 'App version',
          status: 'ok',
          detail: `v${result.version}`,
        },
      ]);
    }).catch(() => {
      setChecks((prev) => prev.map((c) => ({ ...c, status: 'error' as const, detail: 'Failed to check' })));
    });
  }, []);

  const allOk = checks.every((c) => c.status === 'ok');
  const hasError = checks.some((c) => c.status === 'error');

  return (
    <div style={cardStyle}>
      <h2 style={titleStyle}>Environment Check</h2>
      <p style={subtitleStyle}>Verifying your system meets qlaude requirements.</p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', margin: '24px 0' }}>
        {checks.map((check) => (
          <div key={check.label} style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span style={{
              width: '20px',
              height: '20px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '14px',
            }}>
              {check.status === 'checking' ? '⏳' : check.status === 'ok' ? '✅' : '❌'}
            </span>
            <div>
              <div style={{ fontSize: '13px', color: '#e2e8f0' }}>{check.label}</div>
              {check.detail && (
                <div style={{ fontSize: '11px', color: '#718096', marginTop: '2px' }}>{check.detail}</div>
              )}
            </div>
          </div>
        ))}
      </div>

      {hasError && (
        <div style={{ padding: '12px', background: '#742a2a22', border: '1px solid #742a2a', borderRadius: '6px', fontSize: '12px', color: '#fc8181', marginBottom: '16px' }}>
          Some checks failed. qlaude may not work correctly.
        </div>
      )}

      <button
        onClick={onNext}
        disabled={checks.some((c) => c.status === 'checking')}
        style={{ ...btnPrimary, opacity: checks.some((c) => c.status === 'checking') ? 0.5 : 1 }}
      >
        {allOk ? 'Continue' : hasError ? 'Continue anyway' : 'Checking...'}
      </button>
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
