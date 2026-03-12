import React from 'react';
import type { Task } from '../types/global';
import StatusBadge from './StatusBadge';

interface TaskDetailProps {
  task: Task;
}

function MetaRow({ label, value }: { label: string; value: React.ReactNode }): React.ReactElement {
  return (
    <div style={{ display: 'flex', gap: '8px', marginBottom: '8px', fontSize: '13px' }}>
      <span style={{ color: '#718096', width: '110px', flexShrink: 0 }}>{label}</span>
      <span style={{ color: '#e2e8f0', wordBreak: 'break-all' }}>{value ?? '—'}</span>
    </div>
  );
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export default function TaskDetail({ task }: TaskDetailProps): React.ReactElement {
  const directives: string[] = [];
  if (task.is_new_session) directives.push('New session');
  if (task.is_breakpoint) directives.push('Breakpoint (pause after)');
  if (task.label_session) directives.push(`Save session as: ${task.label_session}`);
  if (task.load_session_label) directives.push(`Load session: ${task.load_session_label}`);
  if (task.model_name) directives.push(`Model: ${task.model_name}`);
  if (task.delay_ms) directives.push(`Delay: ${task.delay_ms}ms`);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        padding: '16px',
        overflowY: 'auto',
        gap: '16px',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <StatusBadge status={task.status} />
        <span style={{ fontSize: '13px', color: '#718096' }}>#{task.sort_order + 1}</span>
        {task.title && (
          <span style={{ fontSize: '14px', fontWeight: 600, color: '#e2e8f0', flex: 1 }}>
            {task.title}
          </span>
        )}
      </div>

      {/* Prompt */}
      <div>
        <div style={{ fontSize: '11px', color: '#718096', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Prompt
        </div>
        <pre
          style={{
            margin: 0,
            padding: '12px',
            background: '#0d1117',
            borderRadius: '6px',
            border: '1px solid #2d3748',
            fontFamily: 'ui-monospace, "SF Mono", monospace',
            fontSize: '12px',
            color: '#e2e8f0',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            maxHeight: '240px',
            overflowY: 'auto',
          }}
        >
          {task.prompt}
        </pre>
      </div>

      {/* Metadata */}
      <div>
        <div style={{ fontSize: '11px', color: '#718096', marginBottom: '10px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Metadata
        </div>
        <MetaRow label="Status" value={<StatusBadge status={task.status} />} />
        <MetaRow label="Created" value={formatDate(task.created_at)} />
        <MetaRow label="Started" value={formatDate(task.started_at)} />
        <MetaRow label="Completed" value={formatDate(task.completed_at)} />
        {task.failed_reason && (
          <MetaRow
            label="Failure reason"
            value={
              <span style={{ color: '#fc8181' }}>{task.failed_reason}</span>
            }
          />
        )}
        {task.execution_id && (
          <MetaRow label="Execution ID" value={<span style={{ fontFamily: 'monospace', fontSize: '11px' }}>{task.execution_id}</span>} />
        )}
      </div>

      {/* Directives */}
      {directives.length > 0 && (
        <div>
          <div style={{ fontSize: '11px', color: '#718096', marginBottom: '10px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Directives
          </div>
          <ul style={{ margin: 0, padding: '0 0 0 16px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {directives.map((d) => (
              <li key={d} style={{ fontSize: '13px', color: '#90cdf4' }}>
                {d}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
