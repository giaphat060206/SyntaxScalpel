import { useMemo, useState, type ReactNode } from "react";
import type { ApiEndpoint, ApiInventory } from "../../shared/types";
import { EmptyState } from "../../shared/StateViews";
import { SchemaTree } from "./SchemaTree";

interface Props {
  root: string;
  inventory: ApiInventory;
  onOpenHandler: (file: string, handler: string) => void;
}

interface TagGroup {
  tag: string;
  endpoints: ApiEndpoint[];
}

function endpointKey(endpoint: ApiEndpoint): string {
  return `${endpoint.method} ${endpoint.path}`;
}

function groupByTag(endpoints: ApiEndpoint[]): TagGroup[] {
  const groups = new Map<string, ApiEndpoint[]>();
  for (const endpoint of endpoints) {
    const tag = endpoint.tags[0] ?? "Untagged";
    const existing = groups.get(tag);
    if (existing) {
      existing.push(endpoint);
    } else {
      groups.set(tag, [endpoint]);
    }
  }
  return [...groups.entries()].map(([tag, items]) => ({ tag, endpoints: items }));
}

function matches(endpoint: ApiEndpoint, query: string): boolean {
  return (
    endpoint.method.toLowerCase().includes(query) ||
    endpoint.path.toLowerCase().includes(query) ||
    (endpoint.summary ?? "").toLowerCase().includes(query)
  );
}

export function EndpointsView({ root, inventory, onOpenHandler }: Props) {
  const [query, setQuery] = useState("");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return inventory.endpoints;
    }
    return inventory.endpoints.filter((endpoint) => matches(endpoint, needle));
  }, [inventory.endpoints, query]);

  const groups = useMemo(() => groupByTag(visible), [visible]);

  const selected = useMemo(() => {
    if (selectedKey) {
      const match = visible.find((endpoint) => endpointKey(endpoint) === selectedKey);
      if (match) {
        return match;
      }
    }
    return visible[0] ?? null;
  }, [visible, selectedKey]);

  if (inventory.endpoints.length === 0) {
    return (
      <EmptyState
        message={`No API sources found in ${root}. Searched for OpenAPI/Swagger JSON and YAML documents.`}
      />
    );
  }

  return (
    <div className="flex h-full bg-bg text-xs">
      <div className="flex w-2/5 min-w-[240px] flex-col border-r border-white/10">
        <div className="border-b border-white/10 p-2">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter endpoints…"
            className="w-full rounded border border-white/10 bg-panel px-2 py-1 text-xs text-white/90 outline-none focus:border-accent/50"
          />
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          {groups.length === 0 ? (
            <div className="p-3 text-dimmed">No endpoints match “{query}”.</div>
          ) : (
            groups.map((group) => (
              <section key={group.tag}>
                <h3 className="sticky top-0 z-10 m-0 border-b border-white/10 bg-panel px-3 py-1 font-semibold text-mint">
                  {group.tag}
                </h3>
                <ul className="m-0 list-none p-0">
                  {group.endpoints.map((endpoint) => {
                    const key = endpointKey(endpoint);
                    const active = selected ? endpointKey(selected) === key : false;
                    return (
                      <li key={key}>
                        <button
                          type="button"
                          onClick={() => setSelectedKey(key)}
                          className={`block w-full border-b border-white/5 px-3 py-1.5 text-left hover:bg-accent/10 ${
                            active ? "bg-accent/15" : ""
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <span className="rounded bg-white/10 px-1 font-mono text-[10px] uppercase text-accent">
                              {endpoint.method}
                            </span>
                            <span className="min-w-0 flex-1 truncate font-mono text-white/90">
                              {endpoint.path}
                            </span>
                          </div>
                          {endpoint.summary && (
                            <div className="mt-0.5 truncate text-white/70">
                              {endpoint.summary}
                            </div>
                          )}
                          <div className="mt-0.5 truncate font-mono text-[10px] text-dimmed">
                            {endpoint.file}
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-3">
        {selected ? (
          <EndpointDetail endpoint={selected} onOpenHandler={onOpenHandler} />
        ) : (
          <p className="text-dimmed">Select an endpoint to see its schemas.</p>
        )}
      </div>
    </div>
  );
}

function EndpointDetail({
  endpoint,
  onOpenHandler,
}: {
  endpoint: ApiEndpoint;
  onOpenHandler: (file: string, handler: string) => void;
}) {
  const handler = endpoint.handler;
  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex items-center gap-2">
        <span className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-[10px] uppercase text-accent">
          {endpoint.method}
        </span>
        <span className="break-all font-mono text-sm text-white/90">{endpoint.path}</span>
        <span
          className={`ml-auto rounded px-1.5 py-0.5 text-[10px] uppercase ${
            endpoint.fidelity === "full"
              ? "bg-mint/20 text-mint"
              : "bg-yellow-500/20 text-yellow-300"
          }`}
        >
          {endpoint.fidelity}
        </span>
      </div>

      {handler && (
        <button
          type="button"
          onClick={() => onOpenHandler(endpoint.file, handler)}
          className="mt-2 rounded border border-accent/40 bg-panel px-2 py-1 text-xs text-accent hover:bg-accent/10"
        >
          Open handler
        </button>
      )}

      {endpoint.summary && <p className="mt-2 text-white/85">{endpoint.summary}</p>}
      {endpoint.description && (
        <p className="mt-1 text-white/70">{endpoint.description}</p>
      )}
      <div className="mt-1 font-mono text-[10px] text-dimmed">{endpoint.file}</div>

      <Section title="Parameters">
        {endpoint.parameters.length === 0 ? (
          <div className="text-dimmed">none</div>
        ) : (
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-dimmed">
                <th className="py-1 pr-2 font-medium">Name</th>
                <th className="py-1 pr-2 font-medium">In</th>
                <th className="py-1 pr-2 font-medium">Required</th>
                <th className="py-1 font-medium">Type</th>
              </tr>
            </thead>
            <tbody>
              {endpoint.parameters.map((parameter) => (
                <tr
                  key={`${parameter.in}:${parameter.name}`}
                  className="border-t border-white/5 align-top"
                >
                  <td className="py-1 pr-2 font-mono text-white/90">{parameter.name}</td>
                  <td className="py-1 pr-2 text-white/70">{parameter.in}</td>
                  <td className="py-1 pr-2 text-white/70">
                    {parameter.required ? "yes" : "no"}
                  </td>
                  <td className="py-1">
                    <SchemaTree schema={parameter.schema ?? null} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      {endpoint.requestBody !== undefined && (
        <Section title="Request body">
          <SchemaTree schema={endpoint.requestBody ?? null} />
        </Section>
      )}

      <Section title="Responses">
        {endpoint.responses.length === 0 ? (
          <div className="text-dimmed">none</div>
        ) : (
          <ul className="m-0 list-none space-y-2 p-0">
            {endpoint.responses.map((response) => (
              <li key={response.status}>
                <div className="font-mono text-white/90">{response.status}</div>
                {response.schema !== undefined && response.schema !== null && (
                  <div className="border-l border-white/10 pl-3">
                    <SchemaTree schema={response.schema} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-4">
      <h3 className="m-0 mb-1 text-[10px] font-semibold uppercase tracking-wider text-dimmed">
        {title}
      </h3>
      {children}
    </section>
  );
}
