import React from 'react';
import type { Task } from '../types/global';
import StatusBadge from './StatusBadge';

interface TaskItemProps {
  task: Task;
  selected: boolean;
  onSelect: (task: Task) => void;
  onDelete: (id: string) => void;
  onRun: (id: string) => void;
}

function truncate(str: string, max: number): string {
  if (str.length <= max) return str;
  return str.slice(0, max) + '...';
}

function buildDisplayTitle(task: Task): string {
  if (task.title && task.title.trim()) return task.title.trim();
  return truncate(task.prompt, 40);
}

function DirectiveTags({ task }: { task: Task }): React.ReactElement | null {
  const tags: string[] = [];
  if (task.is_new_session) tags.push('NEW SESSION');
  if (task.is_breakpoint) tags.push('PAUSE');
  if (task.label_session) tags.push(`SAVE:${task.label_session}`);
  if (task.load_session_label) tags.push(`LOAD:${task.load_session_label}`);
  if (task.model_name) tags.push(`MODEL:${task.model_name}`);
  if (task.delay_ms) tags.push(`DELAY:${task.delay_ms}ms`);

  if (tags.length === 0) return null;

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '4px' }}>
      {tags.map((tag) => (
        <span
          key={tag}
          style={{
            fontSize: '10px',
            padding: '1px 5px',
            borderRadius: '3px',
            background: '#0f3460',
            color: '#90cdf4',
            fontFamily: 'monospace',
          }}
        >
          [{tag}]
        </span>
      ))}
    </div>
  );
}

const actionBtn: React.CSSProperties = {
  padding: '3px 8px',
  borderRadius: '4px',
  border: '1px solid #2d3748',
  background: 'transparent',
  color: '#a0aec0',
  fontSize: '11px',
  cursor: 'pointer',
  fontFamily: 'inherit',
};

export default function TaskItem({
  task,
  selected,
  onSelect,
  onDelete,
  onRun,
}: TaskItemProps): React.ReactElement {
  return (
    <div
      onClick={() => onSelect(task)}
      style={{
        display: 'flex',
        flexDirection: 'column',
        padding: '10px 12px',
        background: selected ? '#0f3460' : 'transparent',
        borderBottom: '1px solid #1e2a45',
        cursor: 'pointer',
        transition: 'background 0.15s',
      }}
      onMouseEnter={(e) => {
        if (!selected) (e.currentTarget as HTMLDivElement).style.background = '#1e2a45';
      }}
      onMouseLeave={(e) => {
        if (!selected) (e.currentTarget as HTMLDivElement).style.background = 'transparent';
      }}
    >
      {/* Top row: sort number, status badge, title */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span
          style={{
            fontSize: '11px',
            color: '#4a5568',
            width: '20px',
            textAlign: 'right',
            flexShrink: 0,
          }}
        >
          {task.sort_order + 1}
        </span>

        <StatusBadge status={task.status} />

        <span
          style={{
            fontSize: '13px',
            color: '#e2e8f0',
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {buildDisplayTitle(task)}
        </span>

        {/* Action buttons */}
        <div
          style={{ display: 'flex', gap: '4px', flexShrink: 0 }}
          onClick={(e) => e.stopPropagation()}
        >
          {task.status === 'queued' && (
            <button
              style={{ ...actionBtn, color: '#68d391', borderColor: '#2d6a4f' }}
              onClick={() => onRun(task.id)}
              title="Run now"
            >
              Run
            </button>
          )}
          <button
            style={{ ...actionBtn, color: '#fc8181', borderColor: '#742a2a' }}
            onClick={() => onDelete(task.id)}
            title="Delete task"
          >
            Del
          </button>
        </div>
      </div>

      {/* Directive tags */}
      <DirectiveTags task={task} />
    </div>
  );
}
