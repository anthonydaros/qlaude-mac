import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

interface PackageManifest {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

const repoRoot = path.resolve(import.meta.dirname, '..', '..');

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function readPackageManifest(): PackageManifest {
  return JSON.parse(readRepoFile('package.json')) as PackageManifest;
}

describe('repository CLI surface', () => {
  it('should not expose desktop scripts or Electron dependencies', () => {
    const manifest = readPackageManifest();
    const scripts = manifest.scripts ?? {};
    const dependencies = manifest.dependencies ?? {};
    const devDependencies = manifest.devDependencies ?? {};

    expect(scripts).not.toHaveProperty('dev:electron');
    expect(scripts).not.toHaveProperty('build:electron');
    expect(scripts).not.toHaveProperty('package');
    expect(scripts).not.toHaveProperty('rebuild');
    expect(scripts).not.toHaveProperty('test:e2e');

    expect(dependencies).not.toHaveProperty('react');
    expect(dependencies).not.toHaveProperty('react-dom');

    expect(devDependencies).not.toHaveProperty('@electron/rebuild');
    expect(devDependencies).not.toHaveProperty('@playwright/test');
    expect(devDependencies).not.toHaveProperty('@types/react');
    expect(devDependencies).not.toHaveProperty('@types/react-dom');
    expect(devDependencies).not.toHaveProperty('@vitejs/plugin-react');
    expect(devDependencies).not.toHaveProperty('electron');
    expect(devDependencies).not.toHaveProperty('electron-builder');
    expect(devDependencies).not.toHaveProperty('electron-vite');
  });

  it('should describe qlaude as terminal-only in public docs', () => {
    const readme = readRepoFile('README.md');
    const manual = readRepoFile('MANUAL.md');

    expect(readme).not.toContain('qlaude Desktop');
    expect(readme).not.toContain('dev:electron');
    expect(readme).not.toContain('build:electron');
    expect(readme).not.toContain('Start the desktop app');

    expect(manual).not.toContain('qlaude Desktop');
    expect(manual).not.toContain('dev:electron');
    expect(manual).not.toContain('Electron user data');
    expect(manual).not.toContain('Start the desktop app');
  });

  it('should document a valid CLI smoke command', () => {
    const manual = readRepoFile('MANUAL.md');

    expect(manual).toContain('cd "$SMOKE_WORKSPACE" && HOME="$SMOKE_HOME" qlaude');
    expect(manual).not.toContain('HOME="$SMOKE_HOME" \\');
    expect(manual).not.toContain('(cd "$SMOKE_WORKSPACE" && qlaude)');
  });

  it('should keep the Korean manual aligned for CLI smoke guidance', () => {
    const manualKo = readRepoFile('MANUAL.ko.md');

    expect(manualKo).toContain('### 수동 스모크 체크리스트');
    expect(manualKo).toContain('cd "$SMOKE_WORKSPACE" && HOME="$SMOKE_HOME" qlaude');
    expect(manualKo).toContain('Node.js >= 20.19.0');
  });
});
