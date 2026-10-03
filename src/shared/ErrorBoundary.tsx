import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/** Renders the error instead of a blank pane when a child throws. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("render error", error, info);
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="h-full overflow-auto bg-bg p-4 text-xs text-red-400">
          <div className="font-mono text-sm">Render error</div>
          <pre className="mt-2 whitespace-pre-wrap break-words">
            {this.state.error.message}
          </pre>
          <pre className="mt-2 whitespace-pre-wrap break-words text-dimmed">
            {this.state.error.stack}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}
