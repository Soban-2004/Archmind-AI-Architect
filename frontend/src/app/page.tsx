"use client";

import { useEffect, useState } from "react";
import { ArchitectureCanvas } from "@/components/ArchitectureCanvas";
import { ChatPanel } from "@/components/ChatPanel";
import { api } from "@/lib/api";
import type { ArchitectureState, ChatMessage } from "@/lib/types";

const STORAGE_KEY = "ai-architect-project-id";

export default function Home() {
  const [projectId, setProjectId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [archState, setArchState] = useState<ArchitectureState | null>(null);
  const [versionLabel, setVersionLabel] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const existing = typeof window !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
        if (existing) {
          const project = await api.getProject(existing);
          setProjectId(project.id);
          if (project.latest_version) {
            setArchState(project.latest_version.state);
            setVersionLabel(project.latest_version.kind);
          }
          return;
        }
        const project = await api.createProject("New Project");
        localStorage.setItem(STORAGE_KEY, project.id);
        setProjectId(project.id);
      } catch (e) {
        setInitError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, []);

  async function handleSend(message: string) {
    if (!projectId) return;
    setMessages((prev) => [...prev, { role: "user", content: message }]);
    setBusy(true);
    try {
      const result = await api.sendChatMessage(projectId, message);
      if (result.kind === "question") {
        setMessages((prev) => [...prev, { role: "assistant", content: result.question }]);
      } else if (result.kind === "architecture") {
        setMessages((prev) => [...prev, { role: "assistant", content: result.summary }]);
        setArchState(result.version.state);
        setVersionLabel(result.version.kind);
      } else {
        setMessages((prev) => [...prev, { role: "assistant", content: `⚠️ ${result.error}` }]);
      }
    } catch (e) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `⚠️ ${e instanceof Error ? e.message : String(e)}` },
      ]);
    } finally {
      setBusy(false);
    }
  }

  if (initError) {
    return (
      <div className="flex h-screen items-center justify-center text-sm text-red-600 px-6 text-center">
        Could not reach the backend at NEXT_PUBLIC_API_URL: {initError}
      </div>
    );
  }

  return (
    <div className="flex h-screen">
      <div className="w-[380px] border-r border-slate-200 flex flex-col">
        <div className="border-b border-slate-200 px-4 py-3">
          <h1 className="text-sm font-semibold text-slate-800">AI Architect</h1>
          <p className="text-xs text-slate-400">
            {versionLabel ? `current version: ${versionLabel}` : "new project"}
          </p>
        </div>
        <div className="flex-1 min-h-0">
          <ChatPanel messages={messages} onSend={handleSend} busy={busy || !projectId} />
        </div>
      </div>
      <div className="flex-1">
        <ArchitectureCanvas state={archState} />
      </div>
    </div>
  );
}
