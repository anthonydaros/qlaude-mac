import React, { useState } from 'react';

interface AddTaskModalProps {
  workspacePath: string;
  onClose: () => void;
  onCreated: () => void;
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  background: '#0d1117',
  border: '1px solid #2d3748',
  borderRadius: '5px',
  color: '#e2e8f0',
  fontSize: '13px',
  fontFamily: 'inherit',
  boxSizing: 'border-box',
  outline: 'none',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '12px',
  color: '#718096',
  marginBottom: '5px',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
};

const btnPrimary: React.CSSProperties = {
  padding: '8px 20px',
  borderRadius: '5px',
  border: 'none',
  background: '#0f3460',
  color: '#e2e8f0',
  fontSize: '13px',
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'inherit',
};

const btnSecondary: React.CSSProperties = {
  padding: '8px 20px',
  borderRadius: '5px',
  border: '1px solid #2d3748',
  background: 'transparent',
  color: '#a0aec0',
  fontSize: '13px',
  cursor: 'pointer',
  fontFamily: 'inherit',
};

export default function AddTaskModal({
  workspacePath,
  onClose,
  onCreated,
}: AddTaskModalProps): React.ReactElement {
  const [title, setTitle] = useState('');
  const [prompt, setPrompt] = useState('');
  const [isNewSession, setIsNewSession] = useState(false);
  const [isBreakpoint, setIsBreakpoint] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim()) {
      setError('Prompt is required.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await window.qlaude.tasks.create({
        workspace_path: workspacePath,
        title: title.trim() || undefined,
        prompt: prompt.trim(),
        is_new_session: isNewSession,
        is_breakpoint: isBreakpoint,
      });
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create task.');
      setSubmitting(false);
    }
  };

  return (
    // Overlay
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100,
      }}
    >
      {/* Modal box */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '480px',
          background: '#16213e',
          borderRadius: '10px',
          border: '1px solid #2d3748',
          padding: '24px',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
        }}
      >
        <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: '#e2e8f0' }}>
          Add Task
        </h2>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {/* Title */}
          <div>
            <label style={labelStyle}>Title (optional)</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Short description..."
              style={inputStyle}
            />
          </div>

          {/* Prompt */}
          <div>
            <label style={labelStyle}>Prompt *</label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Enter the prompt for Claude Code..."
              rows={6}
              required
              style={{
                ...inputStyle,
                resize: 'vertical',
                lineHeight: '1.5',
                fontFamily: 'ui-monospace, "SF Mono", monospace',
                fontSize: '12px',
              }}
            />
          </div>

          {/* Checkboxes */}
          <div style={{ display: 'flex', gap: '20px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '7px', fontSize: '13px', color: '#a0aec0', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={isNewSession}
                onChange={(e) => setIsNewSession(e.target.checked)}
                style={{ accentColor: '#0f3460', width: '15px', height: '15px' }}
              />
              New session
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '7px', fontSize: '13px', color: '#a0aec0', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={isBreakpoint}
                onChange={(e) => setIsBreakpoint(e.target.checked)}
                style={{ accentColor: '#0f3460', width: '15px', height: '15px' }}
              />
              Breakpoint (pause after)
            </label>
          </div>

          {/* Error */}
          {error && (
            <div style={{ fontSize: '13px', color: '#fc8181', padding: '8px', background: '#742a2a22', borderRadius: '4px' }}>
              {error}
            </div>
          )}

          {/* Buttons */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', paddingTop: '4px' }}>
            <button type="button" style={btnSecondary} onClick={onClose} disabled={submitting}>
              Cancel
            </button>
            <button type="submit" style={btnPrimary} disabled={submitting}>
              {submitting ? 'Saving...' : 'Save Task'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
