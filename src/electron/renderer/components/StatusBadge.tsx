import React from 'react';
import type { Task } from '../types/global';

type TaskStatus = Task['status'];

const STATUS_STYLES: Record<TaskStatus, { background: string; color: string; label: string }> = {
  queued:    { background: '#2d3748', color: '#a0aec0', label: 'queued' },
  running:   { background: '#1a365d', color: '#63b3ed', label: 'running' },
  completed: { background: '#1c4532', color: '#68d391', label: 'done' },
  failed:    { background: '#742a2a', color: '#fc8181', label: 'failed' },
  paused:    { background: '#744210', color: '#f6ad55', label: 'paused' },
};

interface StatusBadgeProps {
  status: TaskStatus;
}

export default function StatusBadge({ status }: StatusBadgeProps): React.ReactElement {
  const style = STATUS_STYLES[status] ?? STATUS_STYLES.queued;

  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 8px',
        borderRadius: '4px',
        fontSize: '11px',
        fontWeight: 600,
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
        background: style.background,
        color: style.color,
        flexShrink: 0,
      }}
    >
      {style.label}
    </span>
  );
}
