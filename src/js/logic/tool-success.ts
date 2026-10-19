import { showLoader } from './shift-loader.js';

export const TOOL_SUCCESS_ID = 'shift-tool-success';

export type ToolOutput = {
  blob: Blob;
  filename: string;
  summary?: string;
};

/**
 * Displays the shared in-card loader while a tool processes output.
 * Kept as a thin wrapper around `showLoader` after retiring `#shift-tool-success`.
 */
export function showResultLoader(
  text = 'Working...',
  progress?: number,
  root: Document = document
): void {
  const host =
    root.getElementById('tool-uploader') ??
    root.getElementById('signature-editor') ??
    root.getElementById('uploader');
  showLoader(text, progress, host ? { host } : undefined);
}

export function hideToolSuccess(root: Document = document): void {
  root.getElementById(TOOL_SUCCESS_ID)?.remove();
}

export function enqueueToolSuccess(
  _output: ToolOutput,
  _root: Document = document
): void {
  // Retired in ADR-0003: tool output is staged purely on the active Output Session.
}

export function initToolSuccess(_root: Document = document): void {
  // Retired in ADR-0003: #shift-tool-success modal is no longer created or displayed.
}
