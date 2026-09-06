import type { ChatResponse, CompareResult, Scorecard, ScorecardAnswer, SimulationResult, VersionDiff, VersionRow, VersionSummary } from "./types";

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

export interface ProjectSummary {
  id: string;
  name: string;
  created_at: string;
  last_activity_at: string | null;
  node_count: number | null;
}

export const api = {
  createProject: (name: string) =>
    request<{ id: string; name: string; created_at: string }>("/projects", {
      method: "POST",
      body: JSON.stringify({ name }),
    }),

  listProjects: () => request<ProjectSummary[]>("/projects"),

  renameProject: (projectId: string, name: string) =>
    request<{ id: string; name: string; created_at: string }>(`/projects/${projectId}`, {
      method: "PATCH",
      body: JSON.stringify({ name }),
    }),

  deleteProject: (projectId: string) =>
    request<{ ok: boolean }>(`/projects/${projectId}`, { method: "DELETE" }),

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

  sendChatMessage: (projectId: string, message: string, baseVersionId?: string | null) =>
    request<ChatResponse>(`/projects/${projectId}/chat`, {
      method: "POST",
      body: JSON.stringify({ message, base_version_id: baseVersionId ?? null }),
    }),

  compare: (projectId: string, versionAId: string, versionBId: string) =>
    request<CompareResult>(`/projects/${projectId}/compare?version_a=${versionAId}&version_b=${versionBId}`),

  getScorecard: (projectId: string, versionId: string) =>
    request<Scorecard>(`/projects/${projectId}/versions/${versionId}/scorecard`),

  askScorecard: (projectId: string, versionId: string, question: string) =>
    request<{ scorecard: Scorecard; answer: ScorecardAnswer }>(
      `/projects/${projectId}/versions/${versionId}/scorecard/ask`,
      { method: "POST", body: JSON.stringify({ question }) }
    ),

  simulate: (projectId: string, versionId: string, multiplier: number, killNodeIds: string[]) =>
    request<SimulationResult>(`/projects/${projectId}/versions/${versionId}/simulate`, {
      method: "POST",
      body: JSON.stringify({ multiplier, kill_node_ids: killNodeIds }),
    }),
};
