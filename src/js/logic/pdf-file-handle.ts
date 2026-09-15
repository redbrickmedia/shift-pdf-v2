export type FileHandlePermissionMode = 'read' | 'readwrite';

type FileHandlePermissionState = 'granted' | 'denied' | 'prompt';

type PermissionedFileHandle = FileSystemFileHandle & {
  queryPermission?: (descriptor?: {
    mode?: FileHandlePermissionMode;
  }) => Promise<FileHandlePermissionState>;
  requestPermission?: (descriptor?: {
    mode?: FileHandlePermissionMode;
  }) => Promise<FileHandlePermissionState>;
};

type MovableFileHandle = PermissionedFileHandle & {
  move?: (name: string) => Promise<void>;
};

export function sanitizeLibraryFilename(filename: string): string {
  const leaf = filename.replaceAll('\\', '/').split('/').pop()?.trim() ?? '';
  const sanitized = [...leaf]
    .map((char) => {
      const code = char.charCodeAt(0);
      return code < 32 || '\\/:*?"<>|'.includes(char) ? '-' : char;
    })
    .join('')
    .trim();
  const named = sanitized || 'document.pdf';
  return named.toLowerCase().endsWith('.pdf') ? named : `${named}.pdf`;
}

export async function ensureHandlePermission(
  handle: FileSystemFileHandle,
  mode: FileHandlePermissionMode = 'readwrite'
): Promise<boolean> {
  const permissioned = handle as PermissionedFileHandle;
  const descriptor = { mode };
  const current =
    (await permissioned.queryPermission?.(descriptor)) ?? 'prompt';
  if (current === 'granted') return true;
  return (await permissioned.requestPermission?.(descriptor)) === 'granted';
}

export async function writePdfThroughHandle(
  handle: FileSystemFileHandle,
  blob: Blob
): Promise<void> {
  if (!(await ensureHandlePermission(handle))) {
    throw new Error('Shift needs permission to save this PDF.');
  }
  const writable = await handle.createWritable();
  await writable.write(blob);
  await writable.close();
}

export async function renamePdfHandle(
  handle: FileSystemFileHandle,
  filename: string
): Promise<string> {
  const nextName = sanitizeLibraryFilename(filename);
  if (!(await ensureHandlePermission(handle))) {
    throw new Error('Shift needs permission to rename this PDF.');
  }
  const movable = handle as MovableFileHandle;
  if (typeof movable.move !== 'function') {
    throw new Error('This PDF cannot be renamed in place.');
  }
  await movable.move(nextName);
  return nextName;
}
