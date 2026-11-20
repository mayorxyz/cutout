/**
 * In-memory file hand-off between Landing hero drop and /studio.
 * Keeps File objects purely in RAM — never serialized to URL or localStorage.
 */
let pendingHandoffFile: File | null = null;

export function setHandoffFile(file: File): void {
  pendingHandoffFile = file;
}

export function consumeHandoffFile(): File | null {
  const file = pendingHandoffFile;
  pendingHandoffFile = null;
  return file;
}
