const PREFIX = "ai-architect-chat-draft:";
const sessionDrafts = new Map<string, string>();

export function readChatDraft(projectId: string): string {
  if (sessionDrafts.has(projectId)) return sessionDrafts.get(projectId)!;
  try { return localStorage.getItem(PREFIX + projectId) ?? ""; }
  catch { return ""; }
}

export function writeChatDraft(projectId: string, value: string): void {
  sessionDrafts.set(projectId, value);
  try {
    if (value) localStorage.setItem(PREFIX + projectId, value);
    else localStorage.removeItem(PREFIX + projectId);
  } catch { /* A blocked/full store must not prevent typing or sending. */ }
  window.dispatchEvent(new Event("architecture-draft-change"));
}

export function subscribeChatDraft(callback: () => void): () => void {
  function onStorage(event: StorageEvent) {
    if (event.key === null) sessionDrafts.clear();
    else if (event.key.startsWith(PREFIX)) sessionDrafts.delete(event.key.slice(PREFIX.length));
    callback();
  }
  window.addEventListener("architecture-draft-change", callback);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener("architecture-draft-change", callback);
    window.removeEventListener("storage", onStorage);
  };
}
