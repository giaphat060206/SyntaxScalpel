import React from "react";
import ReactDOM from "react-dom/client";
import App from "./features/shell/App";
import { ErrorBoundary } from "./shared/ErrorBoundary";
import "./index.css";

// Non-React failures (async, event handlers) would otherwise leave a blank
// window with no clue; surface them as a fixed overlay.
function installGlobalErrorOverlay(): void {
  const show = (text: string) => {
    let node = document.getElementById("global-error-overlay");
    if (!node) {
      node = document.createElement("pre");
      node.id = "global-error-overlay";
      node.style.cssText =
        "position:fixed;inset:auto 0 0 0;max-height:40vh;overflow:auto;margin:0;" +
        "padding:8px;background:#2a1216;color:#ffb4ab;font:11px/1.4 monospace;z-index:9999";
      document.body.appendChild(node);
    }
    node.textContent = `${node.textContent ?? ""}${text}\n`;
  };
  window.addEventListener("error", (event) => show(`error: ${event.message}`));
  window.addEventListener("unhandledrejection", (event) =>
    show(`rejection: ${String((event as PromiseRejectionEvent).reason)}`)
  );
}

installGlobalErrorOverlay();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
