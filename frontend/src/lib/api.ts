import type { ChatResponse, ChatStreamEvent, CompareResult, IngestResponse, MutationCommand, Scorecard, ScorecardAnswer, SimulationResult, VersionDiff, VersionRow, VersionSummary } from "./types";

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

  /** Direct node edit from the canvas — deterministic, no LLM call. Returns
   * the same shape as a chat "architecture" response (new version + diff)
   * since it goes through the identical apply/finalize path. */
  updateNode: (projectId: string, versionId: string, nodeId: string, attributes: Record<string, unknown>) =>
    request<{ summary: string; version: VersionRow; diff: VersionDiff | null }>(
      `/projects/${projectId}/versions/${versionId}/nodes/${nodeId}`,
      { method: "PATCH", body: JSON.stringify({ attributes }) }
    ),

  /** Manual canvas edits — add a node via the palette, drag-connect two
   * nodes, delete something — as real MutationCommands, going through the
   * exact same validation (including the connectivity registry) and
   * versioning/diff/ADR path a chat edit already does. No LLM call. */
  applyCommands: (projectId: string, versionId: string, commands: MutationCommand[]) =>
    request<{ summary: string; version: VersionRow; diff: VersionDiff | null }>(
      `/projects/${projectId}/versions/${versionId}/commands`,
      { method: "POST", body: JSON.stringify({ commands }) }
    ),

  /** The one case applyCommands above can't cover: a genuinely brand-new
   * project has no version at all yet, so the very first manual add_node
   * has no versionId to branch off. Starts from an empty architecture,
   * same as a project's first chat-proposed one would. */
  applyCommandsToNewProject: (projectId: string, commands: MutationCommand[]) =>
    request<{ summary: string; version: VersionRow; diff: VersionDiff | null }>(`/projects/${projectId}/commands`, {
      method: "POST",
      body: JSON.stringify({ commands }),
    }),

  sendChatMessage: (projectId: string, message: string, baseVersionId?: string | null) =>
    request<ChatResponse>(`/projects/${projectId}/chat`, {
      method: "POST",
      body: JSON.stringify({ message, base_version_id: baseVersionId ?? null }),
    }),

  /** The streaming twin of sendChatMessage — same backend pipeline, real
   * "stage" events as each one actually starts, then one "result" event
   * with the exact same payload sendChatMessage returns directly. An
   * async generator, not EventSource: EventSource only does GET, and this
   * needs a POST body (the message). Parses raw SSE `data: ...\n\n`
   * frames off the fetch response's own ReadableStream by hand — no
   * library needed for a format this simple. */
  async *sendChatMessageStream(projectId: string, message: string, baseVersionId?: string | null): AsyncGenerator<ChatStreamEvent> {
    const res = await fetch(`${API_URL}/projects/${projectId}/chat/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, base_version_id: baseVersionId ?? null }),
    });
    if (!res.ok || !res.body) {
      const body = res.body ? await res.text() : "";
      throw new Error(`${res.status} ${res.statusText}: ${body}`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary: number;
      while ((boundary = buffer.indexOf("\n\n")) !== -1) {
        const rawEvent = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const dataLine = rawEvent.split("\n").find((l) => l.startsWith("data: "));
        if (!dataLine) continue;
        yield JSON.parse(dataLine.slice("data: ".length)) as ChatStreamEvent;
      }
    }
  },

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

  /** Multipart upload — deliberately NOT built on the shared `request`
   * helper above, since that always sets Content-Type: application/json.
   * A browser-built multipart boundary has to come from the browser
   * itself (FormData), not be hand-set. */
  ingestRepo: async (file: File, name: string): Promise<IngestResponse> => {
    const form = new FormData();
    form.append("file", file);
    form.append("name", name);
    const res = await fetch(`${API_URL}/ingest`, { method: "POST", body: form });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`${res.status} ${res.statusText}: ${body}`);
    }
    return res.json();
  },
};
