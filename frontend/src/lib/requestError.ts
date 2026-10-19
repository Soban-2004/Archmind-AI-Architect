export function requestErrorMessage(error: unknown, action: string): string {
  const text = error instanceof Error ? error.message : String(error);
  if (/^404\b/.test(text)) return `${action}: the project is unavailable or this browser doesn’t have access.`;
  if (/^429\b/.test(text)) return `${action}: too many requests. Wait a moment, then retry.`;
  if (/^4\d\d\b/.test(text)) return `${action}: the request couldn’t be accepted. Check your input and retry.`;
  return `${action}. Check your connection and retry.`;
}
