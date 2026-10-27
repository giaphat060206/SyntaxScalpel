import { useState } from "react";
import { GenerateGate, EmptyState, ErrorState } from "../../shared/StateViews";
import { useApiInventory } from "../shell/useApiInventory";
import { EndpointsView } from "./EndpointsView";

interface Props {
  root: string;
  onOpenHandler: (file: string, handler: string) => void;
}

export function EndpointsPane({ root, onOpenHandler }: Props) {
  const [requested, setRequested] = useState(false);
  const state = useApiInventory(root, requested);

  if (!requested) {
    return (
      <div className="flex h-full items-center justify-center bg-bg p-6">
        <div className="max-w-md">
          <GenerateGate
            warning="Analysing the API reads every file in the project looking for OpenAPI documents, @openapi comments and Next.js route handlers. On a large project that takes a while, so it only happens when you ask."
            action="Generate API inventory"
            onGenerate={() => setRequested(true)}
          />
        </div>
      </div>
    );
  }
  if (state.status === "idle" || state.status === "loading") {
    return <EmptyState message="Analysing the API…" />;
  }
  if (state.status === "error") {
    return <ErrorState message={state.message} />;
  }
  return (
    <EndpointsView
      root={root}
      inventory={state.value}
      onOpenHandler={onOpenHandler}
    />
  );
}
