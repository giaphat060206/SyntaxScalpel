import { useMemo, useState } from "react";
import { aiSummary, type AiRequest, type AiSummary, type AiTarget } from "../../shared/ipc";
import { DefinitionPicker } from "./DefinitionPicker";
import { FilePicker } from "./FilePicker";
import { isConfirmed, rememberConfirmed } from "./egress";
import { AI_TASKS } from "./tasks";
import { useAiSettings, PROVIDERS } from "./useAiSettings";

type Mode = "scope" | "files" | "definitions";

interface Props {
  root: string | null;
  scope: string;
  file: string | null;
  onResult: (request: AiRequest, result: AiSummary) => void;
  onClose: () => void;
}

const MODES: { id: Mode; label: string }[] = [
  { id: "scope", label: "Whole scope" },
  { id: "files", label: "Files" },
  { id: "definitions", label: "Definitions" },
];

const field =
  "w-full rounded border border-white/15 bg-bg px-2 py-1 text-xs text-white outline-none focus:border-accent";
const action =
  "rounded border border-accent/40 bg-panel px-2 py-1 text-xs text-accent hover:bg-accent/10 disabled:opacity-40 disabled:hover:bg-panel";

/**
 * The AI panel. Every Task is greyed out until a Provider Key exists, but the
 * key entry itself always stays reachable — otherwise the app dead-ends with no
 * way to satisfy the gate.
 */
export function AiPanel({ root, scope, file, onResult, onClose }: Props) {
  const settings = useAiSettings();
  const [keyDraft, setKeyDraft] = useState("");
  const [running, setRunning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("scope");
  const [files, setFiles] = useState<string[]>([]);
  const [definitions, setDefinitions] = useState<string[]>([]);
  const [pending, setPending] = useState<{ task: string; request: AiRequest } | null>(null);

  const target = useMemo<AiTarget | null>(() => {
    if (!root) {
      return null;
    }
    if (mode === "definitions" && file) {
      return { kind: "definitions", file, ids: definitions };
    }
    if (mode === "files") {
      return { kind: "files", scope, files };
    }
    return { kind: "scope", scope };
  }, [root, mode, file, scope, files, definitions]);

  const choice = settings.provider;
  const blocked = !settings.ready
    ? "Add an API key"
    : !root
      ? "Open a folder first"
      : mode === "definitions" && !file
        ? "Open a code file to pick its definitions"
        : mode === "files" && files.length === 0
          ? "Pick at least one file"
          : mode === "definitions" && definitions.length === 0
            ? "Pick at least one definition"
            : undefined;

  const run = async (task: string) => {
    if (!root || !target) {
      return;
    }
    const request: AiRequest = {
      root,
      target,
      task,
      provider: settings.provider,
      model: settings.model,
    };
    if (!isConfirmed(root)) {
      setPending({ task, request });
      return;
    }
    await send(task, request);
  };

  const send = async (task: string, request: AiRequest) => {
    setRunning(task);
    setError(null);
    try {
      onResult(request, await aiSummary(request));
    } catch (reason: unknown) {
      setError(String(reason));
    } finally {
      setRunning(null);
    }
  };

  const confirmEgress = async () => {
    if (!pending) {
      return;
    }
    rememberConfirmed(pending.request.root);
    const { task, request } = pending;
    setPending(null);
    await send(task, request);
  };

  const providerLabel =
    PROVIDERS.find((entry) => entry.id === settings.provider)?.label ?? settings.provider;

  const save = async () => {
    if (!keyDraft.trim()) {
      return;
    }
    try {
      await settings.saveKey(keyDraft.trim());
      setKeyDraft("");
      setError(null);
    } catch (reason: unknown) {
      setError(String(reason));
    }
  };

  return (
    <div className="absolute right-3 top-3 z-40 w-80 rounded border border-accent/30 bg-panel/95 p-3 text-xs shadow-lg">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wider text-dimmed">AI</span>
        <button type="button" title="Close AI" onClick={onClose} className={action}>
          Close
        </button>
      </div>

      <div className="mt-2 flex items-center gap-1">
        <select
          aria-label="Provider"
          value={choice}
          onChange={(event) => settings.setProvider(event.target.value)}
          className={field}
        >
          {PROVIDERS.map((provider) => (
            <option key={provider.id} value={provider.id}>
              {provider.label}
            </option>
          ))}
        </select>
      </div>

      <input
        aria-label="Model"
        value={settings.model}
        placeholder={PROVIDERS.find((p) => p.id === choice)?.defaultModel}
        onChange={(event) => settings.setModel(event.target.value)}
        className={`mt-1 ${field}`}
      />

      <div className="mt-2 text-[10px] uppercase tracking-wider text-dimmed">
        API key
      </div>
      <div className="mt-1 flex items-center gap-1">
        <input
          aria-label="API key"
          type="password"
          value={keyDraft}
          placeholder={settings.hasKey ? "key saved" : "paste a key"}
          onChange={(event) => setKeyDraft(event.target.value)}
          className={field}
        />
        <button type="button" onClick={save} className={action}>
          Save
        </button>
        {settings.hasKey && (
          <button type="button" onClick={settings.clearKey} className={action}>
            Clear
          </button>
        )}
      </div>

      <div className="mt-3 text-[10px] uppercase tracking-wider text-dimmed">
        What to explain
      </div>
      <div className="mt-1 flex gap-1">
        {MODES.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => setMode(entry.id)}
            className={`flex-1 rounded border px-1 py-1 text-[11px] ${
              mode === entry.id
                ? "border-accent/60 text-accent"
                : "border-white/10 text-white/85 hover:text-accent"
            }`}
          >
            {entry.label}
          </button>
        ))}
      </div>
      <div className="mt-1">
        {mode === "files" && root && (
          <FilePicker
            root={root}
            scope={scope}
            selected={files}
            onChange={setFiles}
          />
        )}
        {mode === "definitions" &&
          (root && file ? (
            <DefinitionPicker
              root={root}
              file={file}
              selected={definitions}
              onChange={setDefinitions}
            />
          ) : (
            <p className="m-0 text-xs text-dimmed">no code file is open</p>
          ))}
        {mode === "scope" && (
          <p className="m-0 text-xs text-dimmed">
            the whole scope, whatever it contains
          </p>
        )}
      </div>

      <div className="mt-3 text-[10px] uppercase tracking-wider text-dimmed">
        What to do
      </div>
      <ul className="m-0 mt-1 list-none space-y-1 p-0">
        {AI_TASKS.map((task) => (
          <li key={task.id}>
            <button
              type="button"
              disabled={blocked !== undefined || running !== null}
              title={blocked ?? task.hint}
              onClick={() => run(task.id)}
              className={`w-full rounded border border-white/10 px-2 py-1 text-left hover:border-accent/40 hover:text-accent disabled:opacity-40 disabled:hover:border-white/10 disabled:hover:text-white/85 ${
                running === task.id ? "text-accent" : "text-white/90"
              }`}
            >
              {running === task.id ? `${task.label}…` : task.label}
              <span className="block text-[10px] text-dimmed">{task.hint}</span>
            </button>
          </li>
        ))}
      </ul>

      {pending && (
        <div className="mt-2 rounded border border-yellow-500/40 bg-panel p-2 text-xs text-yellow-200">
          <p className="m-0">
            This sends a summary of the selected code to <strong>{providerLabel}</strong>. It
            leaves this machine.
          </p>
          <div className="mt-1 flex gap-1">
            <button type="button" onClick={confirmEgress} className={action}>
              Send to {providerLabel}
            </button>
            <button type="button" onClick={() => setPending(null)} className={action}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {(error ?? settings.error) && (
        <p className="mt-2 break-words text-red-400">{error ?? settings.error}</p>
      )}
    </div>
  );
}
