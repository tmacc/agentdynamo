import { createFileRoute } from "@tanstack/react-router";

import { ProjectContextSettingsPanel } from "../components/settings/ProjectContextSettingsPanel";

export const Route = createFileRoute("/settings/project-context")({
  component: ProjectContextSettingsPanel,
});
