const LANGUAGES: Record<string, string> = {
  py: "Python",
  js: "JavaScript",
  jsx: "JavaScript",
  ts: "TypeScript",
  tsx: "TypeScript",
  rs: "Rust",
  md: "Markdown",
  json: "JSON",
  yaml: "YAML",
  yml: "YAML",
  toml: "TOML",
  ini: "INI",
  css: "CSS",
  scss: "CSS",
  html: "HTML",
  sql: "SQL",
  sh: "Shell",
  txt: "Text",
};

/**
 * The label a file counts under in the dashboard's ratio. Every extension the
 * parser recognises gets its own name, so a TypeScript project does not read as
 * "jsts"; anything else lands in Other rather than being dropped, and the counts
 * still add up to the number of files.
 */
export function languageForName(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) {
    return "Other";
  }
  return LANGUAGES[name.slice(dot + 1).toLowerCase()] ?? "Other";
}
