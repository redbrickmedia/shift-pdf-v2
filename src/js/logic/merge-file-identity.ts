export type MergeFileIdentity = {
  name: string;
  size: number;
  libraryId?: string;
};

export function mergeFileIdentityKey(identity: MergeFileIdentity): string {
  if (identity.libraryId) return `id:${identity.libraryId}`;
  return `file:${identity.name}:${identity.size}`;
}

export function mergeFilesMatch(
  left: MergeFileIdentity,
  right: MergeFileIdentity
): boolean {
  if (left.libraryId && right.libraryId) {
    return left.libraryId === right.libraryId;
  }
  return left.name === right.name && left.size === right.size;
}

export function isDuplicateMergeFile(
  existing: MergeFileIdentity[],
  candidate: MergeFileIdentity
): boolean {
  return existing.some((item) => mergeFilesMatch(item, candidate));
}
