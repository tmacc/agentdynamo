import { ScanSearchIcon } from "lucide-react";

import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "../ui/empty";

export function ProjectIntelligenceEmptyState(props: {
  title?: string;
  description?: string;
  action?: React.ReactNode;
}) {
  const title = props.title ?? "No agentic context discovered";
  const description =
    props.description ??
    "We could not find any instructions, skills, hooks, MCP servers, or memory in this workspace yet. Add files like AGENTS.md, .claude/, .codex/, or .agents/ to make context visible.";
  return (
    <Empty className="min-h-[280px]">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <ScanSearchIcon />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      {props.action ? <div className="pt-2">{props.action}</div> : null}
    </Empty>
  );
}
