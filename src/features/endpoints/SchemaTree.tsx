import type { Json } from "../../shared/types";

interface SchemaObject {
  [key: string]: Json;
}

function isObject(value: Json): value is SchemaObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function typeName(schema: SchemaObject): string {
  const type = schema.type;
  if (typeof type === "string") {
    return schema.nullable === true ? `${type} | null` : type;
  }
  if (Array.isArray(type)) {
    const names = type.filter((entry): entry is string => typeof entry === "string");
    return names.length > 0 ? names.join(" | ") : "any";
  }
  if (isObject(schema.properties)) return "object";
  if (schema.items !== undefined) return "array";
  if (Array.isArray(schema.oneOf)) return "one of";
  if (Array.isArray(schema.anyOf)) return "any of";
  if (Array.isArray(schema.allOf)) return "all of";
  return "any";
}

export function SchemaTree({ schema }: { schema: Json; depth?: number }) {
  if (schema === null || schema === undefined) {
    return null;
  }
  if (!isObject(schema)) {
    return <span className="font-mono text-white/70">{String(schema)}</span>;
  }
  if (typeof schema.ref === "string") {
    return <span className="font-mono text-accent/80">{schema.ref}</span>;
  }

  const properties = isObject(schema.properties) ? schema.properties : null;
  const required = Array.isArray(schema.required)
    ? schema.required.filter((name): name is string => typeof name === "string")
    : [];
  const items = schema.items;
  const alternatives = Array.isArray(schema.oneOf)
    ? schema.oneOf
    : Array.isArray(schema.anyOf)
      ? schema.anyOf
      : Array.isArray(schema.allOf)
        ? schema.allOf
        : null;
  const enumValues = Array.isArray(schema.enum) ? schema.enum : null;

  return (
    <span className="block">
      <span className="font-mono text-mint">{typeName(schema)}</span>
      {enumValues && (
        <span className="ml-1 text-white/60">
          enum: {enumValues.map((value) => String(value)).join(", ")}
        </span>
      )}
      {properties && (
        <ul className="m-0 mt-0.5 list-none border-l border-white/10 pl-3">
          {Object.entries(properties).map(([name, child]) => (
            <li key={name}>
              <span className="font-mono text-white/90">{name}</span>
              {required.includes(name) && <span className="text-red-400">*</span>}
              <span className="mx-1 text-dimmed">:</span>
              <SchemaTree schema={child} />
            </li>
          ))}
        </ul>
      )}
      {items !== undefined && (
        <span className="block border-l border-white/10 pl-3">
          <span className="text-dimmed">items </span>
          <SchemaTree schema={items} />
        </span>
      )}
      {alternatives && (
        <ul className="m-0 mt-0.5 list-none border-l border-white/10 pl-3">
          {alternatives.map((alternative, index) => (
            <li key={index}>
              <SchemaTree schema={alternative} />
            </li>
          ))}
        </ul>
      )}
    </span>
  );
}
