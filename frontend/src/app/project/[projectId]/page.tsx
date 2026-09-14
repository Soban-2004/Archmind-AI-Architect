import { AppShell } from "@/components/AppShell";

/** The real, bookmarkable/deep-linkable URL for an open project — a
 * refresh, a browser back/forward, or a pasted link all land a returning
 * guest-token holder straight back in their own project instead of always
 * starting from the project list. AppShell reads the :projectId segment
 * itself via useParams() (see its routeProjectId effect); this file is
 * deliberately just that, the same shared component the bare "/" route
 * renders, so there is exactly one place the actual app logic lives. */
export default function ProjectPage() {
  return <AppShell />;
}
