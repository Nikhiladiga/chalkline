import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import { type BrowserWindow, dialog } from 'electron';
import type { CodeProject, ProjectScan } from '../shared/project';
import { scanProject } from './projectScan';

const folders = new Map<string, string>();

export async function chooseProject(win: BrowserWindow): Promise<CodeProject | null> {
  const selected =
    process.env.DG_TEST && process.env.DG_TEST_PROJECT_DIR
      ? { canceled: false, filePaths: [process.env.DG_TEST_PROJECT_DIR] }
      : await dialog.showOpenDialog(win, { title: 'Choose a code folder', properties: ['openDirectory'] });
  if (selected.canceled || !selected.filePaths[0]) return null;
  const path = selected.filePaths[0];
  const id = randomUUID();
  folders.set(id, path);
  if (folders.size > 8) folders.delete(folders.keys().next().value!);
  return { id, name: basename(path) };
}

export function projectPath(id: string): string {
  const path = folders.get(id);
  if (!path) throw new Error('Choose the code folder again before scanning.');
  return path;
}

export function scanSelectedProject(
  projectId: string,
  maxChars: number,
  signal: AbortSignal,
): Promise<ProjectScan> {
  return scanProject(projectPath(projectId), { maxChars, signal });
}
