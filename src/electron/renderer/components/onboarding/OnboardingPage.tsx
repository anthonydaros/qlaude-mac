import React, { useState } from 'react';
import EnvironmentCheck from './EnvironmentCheck';
import TelegramSetup from './TelegramSetup';
import WorkspaceSelect from './WorkspaceSelect';
import ReviewStep from './ReviewStep';

interface OnboardingPageProps {
  onComplete: () => void;
}

const STEPS = ['Environment', 'Telegram', 'Workspace', 'Review'];

export default function OnboardingPage({ onComplete }: OnboardingPageProps): React.ReactElement {
  const [step, setStep] = useState(0);
  const [telegramToken, setTelegramToken] = useState('');
  const [telegramChatId, setTelegramChatId] = useState('');
  const [workspacePath, setWorkspacePath] = useState('');

  const handleTelegramDone = (token: string, chatId: string) => {
    setTelegramToken(token);
    setTelegramChatId(chatId);
    setStep(2);
  };

  const handleWorkspaceDone = (path: string) => {
    setWorkspacePath(path);
    setStep(3);
  };

  const handleComplete = async () => {
    await window.qlaude.onboarding.complete();
    onComplete();
  };

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      minHeight: '100vh',
      background: '#1a1a2e',
      color: '#e2e8f0',
      fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif',
      padding: '40px 20px',
    }}>
      {/* Header */}
      <div style={{ marginBottom: '32px', textAlign: 'center' }}>
        <h1 style={{ fontSize: '2rem', fontWeight: 700, margin: '0 0 8px', letterSpacing: '-0.02em' }}>
          qlaude Desktop
        </h1>
        <p style={{ color: '#718096', fontSize: '14px', margin: 0 }}>
          Let's get you set up in a few steps
        </p>
      </div>

      {/* Step indicators */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '32px', alignItems: 'center' }}>
        {STEPS.map((label, i) => (
          <React.Fragment key={label}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
              <div style={{
                width: '28px',
                height: '28px',
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '12px',
                fontWeight: 600,
                background: i < step ? '#0f3460' : i === step ? '#e2e8f0' : '#2d3748',
                color: i < step ? '#63b3ed' : i === step ? '#1a1a2e' : '#4a5568',
                border: i < step ? '2px solid #63b3ed' : i === step ? '2px solid #e2e8f0' : '2px solid #2d3748',
                transition: 'all 0.2s',
              }}>
                {i < step ? '✓' : i + 1}
              </div>
              <span style={{ fontSize: '10px', color: i === step ? '#e2e8f0' : '#4a5568' }}>
                {label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div style={{
                width: '48px',
                height: '2px',
                background: i < step ? '#0f3460' : '#2d3748',
                marginBottom: '14px',
                transition: 'background 0.2s',
              }} />
            )}
          </React.Fragment>
        ))}
      </div>

      {/* Step content */}
      <div style={{ width: '100%', maxWidth: '480px' }}>
        {step === 0 && <EnvironmentCheck onNext={() => setStep(1)} />}
        {step === 1 && <TelegramSetup onDone={handleTelegramDone} />}
        {step === 2 && (
          <WorkspaceSelect
            onDone={handleWorkspaceDone}
            onSkip={() => setStep(3)}
          />
        )}
        {step === 3 && (
          <ReviewStep
            telegramToken={telegramToken}
            telegramChatId={telegramChatId}
            workspacePath={workspacePath}
            onComplete={handleComplete}
          />
        )}
      </div>
    </div>
  );
}
