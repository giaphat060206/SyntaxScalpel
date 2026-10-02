import { EmptyState, ErrorState } from "../../shared/StateViews";
import { useApiInventory } from "../shell/useApiInventory";
import { EndpointsView } from "./EndpointsView";

interface Props {
  root: string;
  onOpenHandler: (file: string, handler: string) => void;
}

export function EndpointsPane({ root, onOpenHandler }: Props) {
  const state = useApiInventory(root);

  if (state.status === "idle" || state.status === "loading") {
    return <EmptyState message="Loading API…" />;
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
