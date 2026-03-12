import React, { useState } from 'react';

interface TelegramSetupProps {
  onDone: (token: string, chatId: string) => void;
}

type Phase = 'token' | 'chatId' | 'test' | 'done';

export default function TelegramSetup({ onDone }: TelegramSetupProps): React.ReactElement {
  const [phase, setPhase] = useState<Phase>('token');
  const [token, setToken] = useState('');
  const [botName, setBotName] = useState('');
  const [chatId, setChatId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleValidateToken = async () => {
    setLoading(true);
    setError(null);
    try {
      const name: string | null = await window.qlaude.telegram.validateToken(token.trim());
      if (name) {
        setBotName(name);
        setPhase('chatId');
      } else {
        setError('Invalid bot token. Please check and try again.');
      }
    } catch {
      setError('Failed to validate token. Check your internet connection.');
    } finally {
      setLoading(false);
    }
  };

  const handleDetectChatId = async () => {
    setLoading(true);
    setError(null);
    try {
      const detected: string | null = await window.qlaude.telegram.detectChatId(token.trim());
      if (detected) {
        setChatId(detected);
        setPhase('test');
      } else {
        setError('No message received. Send any message to your bot and try again.');
      }
    } catch {
      setError('Failed to detect chat ID.');
    } finally {
      setLoading(false);
    }
  };

  const handleTestAndSave = async () => {
    setLoading(true);
    setError(null);
    try {
      await window.qlaude.telegram.saveConfig({ botToken: token.trim(), chatId });
      const result: { ok: boolean } = await window.qlaude.telegram.testConnection();
      if (result.ok) {
        setPhase('done');
        setTimeout(() => onDone(token.trim(), chatId), 800);
      } else {
        setError('Test message failed to send. Check your bot token and chat ID.');
      }
    } catch {
      setError('Failed to save configuration.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={cardStyle}>
      <h2 style={titleStyle}>Telegram Setup</h2>
      <p style={subtitleStyle}>
        Telegram is required to control qlaude remotely.{' '}
        <a
          href="https://core.telegram.org/bots#botfather"
          style={{ color: '#63b3ed', textDecoration: 'none' }}
          onClick={(e) => { e.preventDefault(); }}
        >
          Create a bot with @BotFather
        </a>
      </p>

      <div style={{ marginTop: '20px' }}>
        {/* Step 1: Token */}
        <div style={stepStyle(phase === 'token')}>
          <div style={stepHeaderStyle}>
            <span style={stepNumStyle(phase !== 'token')}>1</span>
            <span style={{ fontSize: '13px', fontWeight: 600, color: '#e2e8f0' }}>Enter Bot Token</span>
            {phase !== 'token' && botName && (
              <span style={{ marginLeft: 'auto', fontSize: '12px', color: '#68d391' }}>✓ @{botName}</span>
            )}
          </div>
          {phase === 'token' && (
            <div style={{ marginTop: '12px' }}>
              <input
                type="text"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="1234567890:ABCdef..."
                style={inputStyle}
                onKeyDown={(e) => e.key === 'Enter' && !loading && token && handleValidateToken()}
              />
              {error && phase === 'token' && <div style={errorStyle}>{error}</div>}
              <button
                onClick={handleValidateToken}
                disabled={loading || !token.trim()}
                style={{ ...btnPrimary, marginTop: '10px', opacity: (loading || !token.trim()) ? 0.5 : 1 }}
              >
                {loading ? 'Validating...' : 'Validate Token'}
              </button>
            </div>
          )}
        </div>

        {/* Step 2: Chat ID */}
        <div style={{ ...stepStyle(phase === 'chatId'), marginTop: '12px' }}>
          <div style={stepHeaderStyle}>
            <span style={stepNumStyle(phase !== 'chatId' && phase !== 'token')}>2</span>
            <span style={{ fontSize: '13px', fontWeight: 600, color: phase === 'token' ? '#4a5568' : '#e2e8f0' }}>
              Detect Chat ID
            </span>
            {(phase === 'test' || phase === 'done') && (
              <span style={{ marginLeft: 'auto', fontSize: '12px', color: '#68d391' }}>✓ {chatId}</span>
            )}
          </div>
          {phase === 'chatId' && (
            <div style={{ marginTop: '12px' }}>
              <p style={{ fontSize: '12px', color: '#718096', margin: '0 0 10px' }}>
                Send any message to your bot on Telegram, then click Detect.
              </p>
              {error && phase === 'chatId' && <div style={errorStyle}>{error}</div>}
              <button
                onClick={handleDetectChatId}
                disabled={loading}
                style={{ ...btnPrimary, opacity: loading ? 0.5 : 1 }}
              >
                {loading ? 'Detecting...' : 'Detect Chat ID'}
              </button>
            </div>
          )}
        </div>

        {/* Step 3: Test */}
        <div style={{ ...stepStyle(phase === 'test'), marginTop: '12px' }}>
          <div style={stepHeaderStyle}>
            <span style={stepNumStyle(phase === 'done')}>3</span>
            <span style={{ fontSize: '13px', fontWeight: 600, color: phase === 'token' || phase === 'chatId' ? '#4a5568' : '#e2e8f0' }}>
              Test & Save
            </span>
            {phase === 'done' && (
              <span style={{ marginLeft: 'auto', fontSize: '12px', color: '#68d391' }}>✓ Connected</span>
            )}
          </div>
          {phase === 'test' && (
            <div style={{ marginTop: '12px' }}>
              <p style={{ fontSize: '12px', color: '#718096', margin: '0 0 10px' }}>
                Send a test message to confirm everything works.
              </p>
              {error && <div style={errorStyle}>{error}</div>}
              <button
                onClick={handleTestAndSave}
                disabled={loading}
                style={{ ...btnPrimary, opacity: loading ? 0.5 : 1 }}
              >
                {loading ? 'Sending...' : 'Send Test & Save'}
              </button>
            </div>
          )}
          {phase === 'done' && (
            <div style={{ marginTop: '8px', fontSize: '12px', color: '#68d391' }}>
              Telegram connected successfully!
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function stepStyle(active: boolean): React.CSSProperties {
  return {
    padding: '12px 14px',
    borderRadius: '8px',
    border: `1px solid ${active ? '#0f3460' : '#2d3748'}`,
    background: active ? '#0f346011' : 'transparent',
    transition: 'all 0.15s',
  };
}

function stepNumStyle(completed: boolean): React.CSSProperties {
  return {
    width: '20px',
    height: '20px',
    borderRadius: '50%',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '11px',
    fontWeight: 700,
    background: completed ? '#0f3460' : '#2d3748',
    color: completed ? '#63b3ed' : '#718096',
    marginRight: '8px',
    flexShrink: 0,
  };
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

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  background: '#0d1117',
  border: '1px solid #2d3748',
  borderRadius: '5px',
  color: '#e2e8f0',
  fontSize: '13px',
  fontFamily: 'ui-monospace, "SF Mono", monospace',
  boxSizing: 'border-box',
  outline: 'none',
};

const stepHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
};

const btnPrimary: React.CSSProperties = {
  width: '100%',
  padding: '9px',
  borderRadius: '6px',
  border: 'none',
  background: '#0f3460',
  color: '#e2e8f0',
  fontSize: '13px',
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'inherit',
};

const errorStyle: React.CSSProperties = {
  fontSize: '12px',
  color: '#fc8181',
  padding: '8px',
  background: '#742a2a22',
  borderRadius: '4px',
  marginBottom: '8px',
};
