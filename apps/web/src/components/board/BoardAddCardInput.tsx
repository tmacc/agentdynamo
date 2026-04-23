import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { useCallback, useEffect, useRef, useState } from "react";

import { createBoardCard } from "../../boardStore";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

interface BoardAddCardInputProps {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly column: "ideas" | "planned";
  readonly onDone: () => void;
}

export function BoardAddCardInput({
  environmentId,
  projectId,
  column,
  onDone,
}: BoardAddCardInputProps) {
  const [value, setValue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = useCallback(async () => {
    const title = value.trim();
    if (title.length === 0) {
      onDone();
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await createBoardCard({
        environmentId,
        projectId,
        title,
        description: null,
        seededPrompt: null,
        column,
      });
      setValue("");
      onDone();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to add card");
    } finally {
      setSubmitting(false);
    }
  }, [column, environmentId, onDone, projectId, value]);

  return (
    <div className="rounded-md border bg-background p-2">
      <Input
        ref={inputRef}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder={column === "ideas" ? "New idea title..." : "New planned item..."}
        className="h-7 text-xs"
        disabled={submitting}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            void handleSubmit();
            return;
          }
          if (event.key === "Escape") {
            event.preventDefault();
            onDone();
          }
        }}
      />
      {error ? <div className="mt-1 text-[10px] text-destructive">{error}</div> : null}
      <div className="mt-1.5 flex items-center justify-end gap-1">
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-2 text-[10px]"
          onClick={onDone}
          disabled={submitting}
        >
          Cancel
        </Button>
        <Button
          size="sm"
          className="h-6 px-2 text-[10px]"
          onClick={() => void handleSubmit()}
          disabled={submitting || value.trim().length === 0}
        >
          Add
        </Button>
      </div>
    </div>
  );
}
