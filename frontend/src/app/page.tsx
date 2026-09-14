import { AppShell } from "@/components/AppShell";

/** The bare "/" route: the project list / landing entry point. AppShell
 * reads its starting project (if any) from the URL itself via useParams(),
 * which returns nothing on this route — see AppShell's routeProjectId. */
export default function Home() {
  return <AppShell />;
}
