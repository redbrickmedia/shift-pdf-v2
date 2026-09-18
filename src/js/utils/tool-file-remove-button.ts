/**
 * Shared control for removing a selected file from a tool (not deleting from the library).
 * Uses an X / cross icon so the action reads as "remove", not "delete".
 */
export type ToolFileRemoveButtonOptions = {
  fileName?: string;
  className?: string;
  iconClassName?: string;
  root?: Document;
};

export function toolFileRemoveLabel(fileName?: string): string {
  return fileName ? `Remove ${fileName}` : 'Remove file';
}

export function createToolFileRemoveButton(
  options: ToolFileRemoveButtonOptions = {}
): HTMLButtonElement {
  const root = options.root ?? document;
  const button = root.createElement('button');
  button.type = 'button';
  button.className =
    options.className ?? 'ml-4 flex-shrink-0 shift-tool-file-remove';

  const label = toolFileRemoveLabel(options.fileName);
  button.setAttribute('aria-label', label);
  button.title = label;

  const icon = root.createElement('i');
  icon.setAttribute('data-lucide', 'x');
  icon.className = options.iconClassName ?? 'w-4 h-4';
  button.appendChild(icon);

  return button;
}
