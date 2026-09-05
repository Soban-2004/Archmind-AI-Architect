import type { ChatResponse, VersionDiff, VersionRow, VersionSummary } from "./types";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${body}`);
  }
  return res.json();
}

export interface Project {
  id: string;
  name: string;
  created_at: string;
  latest_version: VersionRow | null;
}

export const api = {
  createProject: (name: string) =>
    request<{ id: string; name: string; created_at: string }>("/projects", {
      method: "POST",
      body: JSON.stringify({ name }),
    }),

  getProject: (projectId: string) => request<Project>(`/projects/${projectId}`),

  listVersions: (projectId: string) => request<VersionSummary[]>(`/projects/${projectId}/versions`),

  getVersion: (projectId: string, versionId: string) =>
    request<VersionRow>(`/projects/${projectId}/versions/${versionId}`),

  getDiff: (projectId: string, versionId: string, against?: string) =>
    request<VersionDiff>(
      `/projects/${projectId}/versions/${versionId}/diff${against ? `?against=${against}` : ""}`
    ),

  updateLayout: (projectId: string, versionId: string, layout: Record<string, { x: number; y: number }>) =>
    request<{ ok: boolean }>(`/projects/${projectId}/versions/${versionId}/layout`, {
      method: "PUT",
      body: JSON.stringify({ layout }),
    }),

  sendChatMessage: (projectId: string, message: string) =>
    request<ChatResponse>(`/projects/${projectId}/chat`, {
      method: "POST",
      body: JSON.stringify({ message }),
    }),
};
