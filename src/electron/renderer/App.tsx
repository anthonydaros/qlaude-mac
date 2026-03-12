import React, { useCallback, useEffect, useState } from 'react';
import type { Task } from './types/global';
import { useEngine } from './hooks/useEngine';
import { useTasks } from './hooks/useTasks';
import TopBar from './components/TopBar';
import TaskItem from './components/TaskItem';
import TaskDetail from './components/TaskDetail';
import AddTaskModal from './components/AddTaskModal';
import OnboardingPage from './components/onboarding/OnboardingPage';

type StatusFilter = 'all' | Task['status'];

const FILTERS: { label: string; value: StatusFilter }[] = [
  { label: 'All', value: 'all' },
  { label: 'Queued', value: 'queued' },
  { label: 'Running', value: 'running' },
  { label: 'Completed', value: 'completed' },
  { label: 'Failed', value: 'failed' },
];

function filterTasks(tasks: Task[], filter: StatusFilter): Task[] {
  if (filter === 'all') return tasks;
  return tasks.filter((t) => t.status === filter);
}

export default function App(): React.ReactElement {
  const [onboardingComplete, setOnboardingComplete] = useState<boolean | null>(null);
  const [workspacePath, setWorkspacePath] = useState<string | null>(null);
  const [workspaceName, setWorkspaceName] = useState<string | null>(null);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [showAddModal, setShowAddModal] = useState(false);

  const { engineState, isPaused } = useEngine();
  const { tasks, loading: tasksLoading, refetch: refetchTasks } = useTasks(workspacePath);

  // Check onboarding status on mount
  useEffect(() => {
    window.qlaude.onboarding.getStatus().then(({ completed }) => {
      setOnboardingComplete(completed);
    }).catch(() => {
      // Default to complete if check fails, so app is usable
      setOnboardingComplete(true);
    });
  }, []);

  // Load saved workspace on mount
  useEffect(() => {
    window.qlaude.workspace.get().then((info) => {
      if (info?.path) {
        setWorkspacePath(info.path);
        setWorkspaceName(info.name);
      }
    }).catch(() => {
      // No workspace saved yet
    });
  }, []);

  // Reload tasks when workspace changes
  useEffect(() => {
    if (workspacePath) refetchTasks();
  }, [workspacePath, refetchTasks]);

  const handleOpenFolder = useCallback(async () => {
    const info = await window.qlaude.workspace.open();
    if (info) {
      setWorkspacePath(info.path);
      setWorkspaceName(info.name);
      setSelectedTask(null);
    }
  }, []);

  const handleStart = useCallback(async () => {
    if (!workspacePath) return;
    await window.qlaude.queue.start(workspacePath);
  }, [workspacePath]);

  const handlePause = useCallback(async () => {
    await window.qlaude.queue.pause();
  }, []);

  const handleResume = useCallback(async () => {
    await window.qlaude.queue.resume();
  }, []);

  const handleDelete = useCallback(async (id: string) => {
    await window.qlaude.tasks.delete(id);
    setSelectedTask((prev) => (prev?.id === id ? null : prev));
    refetchTasks();
  }, [refetchTasks]);

  const handleRun = useCallback(async (id: string) => {
    // Move task to front by setting sort_order to -1 (will be normalized by backend)
    await window.qlaude.tasks.reorder(id, 0);
    refetchTasks();
  }, [refetchTasks]);

  // Loading state
  if (onboardingComplete === null) {
    return (
      <div style={centeredLayout}>
        <span style={{ color: '#718096' }}>Loading...</span>
      </div>
    );
  }

  // Onboarding wizard
  if (!onboardingComplete) {
    return (
      <OnboardingPage
        onComplete={() => setOnboardingComplete(true)}
      />
    );
  }

  const visibleTasks = filterTasks(tasks, statusFilter);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        background: '#1a1a2e',
        color: '#e2e8f0',
        fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif',
        overflow: 'hidden',
      }}
    >
      {/* Top bar */}
      <TopBar
        workspaceName={workspaceName}
        engineState={engineState}
        onOpenFolder={handleOpenFolder}
        onStart={handleStart}
        onPause={handlePause}
        onResume={handleResume}
      />

      {/* Content area */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Left panel: task list */}
        <div
          style={{
            width: '60%',
            display: 'flex',
            flexDirection: 'column',
            borderRight: '1px solid #2d3748',
            overflow: 'hidden',
          }}
        >
          {/* Filter tabs + Add button */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              padding: '0 12px',
              borderBottom: '1px solid #2d3748',
              background: '#16213e',
              flexShrink: 0,
              gap: '4px',
              height: '40px',
            }}
          >
            {FILTERS.map(({ label, value }) => (
              <button
                key={value}
                onClick={() => setStatusFilter(value)}
                style={{
                  padding: '4px 10px',
                  borderRadius: '4px',
                  border: 'none',
                  background: statusFilter === value ? '#0f3460' : 'transparent',
                  color: statusFilter === value ? '#e2e8f0' : '#718096',
                  fontSize: '12px',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  fontWeight: statusFilter === value ? 600 : 400,
                }}
              >
                {label}
              </button>
            ))}

            <div style={{ flex: 1 }} />

            {/* Add task button */}
            <button
              onClick={() => setShowAddModal(true)}
              disabled={!workspacePath}
              title={workspacePath ? 'Add task' : 'Open a workspace first'}
              style={{
                width: '26px',
                height: '26px',
                borderRadius: '5px',
                border: '1px solid #2d3748',
                background: workspacePath ? '#0f3460' : '#2d3748',
                color: workspacePath ? '#e2e8f0' : '#4a5568',
                fontSize: '18px',
                lineHeight: '1',
                cursor: workspacePath ? 'pointer' : 'not-allowed',
                fontFamily: 'inherit',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              +
            </button>
          </div>

          {/* Task list */}
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {!workspacePath ? (
              <div style={{ padding: '32px', textAlign: 'center', color: '#4a5568', fontSize: '13px' }}>
                Open a workspace folder to get started.
              </div>
            ) : tasksLoading ? (
              <div style={{ padding: '32px', textAlign: 'center', color: '#4a5568', fontSize: '13px' }}>
                Loading tasks...
              </div>
            ) : visibleTasks.length === 0 ? (
              <div style={{ padding: '32px', textAlign: 'center', color: '#4a5568', fontSize: '13px' }}>
                No tasks{statusFilter !== 'all' ? ` with status "${statusFilter}"` : ''}.
              </div>
            ) : (
              visibleTasks.map((task) => (
                <TaskItem
                  key={task.id}
                  task={task}
                  selected={selectedTask?.id === task.id}
                  onSelect={setSelectedTask}
                  onDelete={handleDelete}
                  onRun={handleRun}
                />
              ))
            )}
          </div>
        </div>

        {/* Right panel: task detail or placeholder */}
        <div
          style={{
            width: '40%',
            background: '#16213e',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {selectedTask ? (
            <TaskDetail task={selectedTask} />
          ) : (
            <div
              style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#4a5568',
                fontSize: '13px',
              }}
            >
              {isPaused
                ? 'Engine paused'
                : engineState === 'running'
                ? 'Engine running...'
                : 'Select a task to view details'}
            </div>
          )}
        </div>
      </div>

      {/* Add task modal */}
      {showAddModal && workspacePath && (
        <AddTaskModal
          workspacePath={workspacePath}
          onClose={() => setShowAddModal(false)}
          onCreated={refetchTasks}
        />
      )}
    </div>
  );
}

const centeredLayout: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  height: '100vh',
  background: '#1a1a2e',
  color: '#e2e8f0',
  fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif',
};
