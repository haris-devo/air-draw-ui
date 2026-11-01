// lib/clean-code.ts
// Normalizes model output into a bare component the preview iframe can run.

export function cleanCode(raw: string): string {
  let code = raw.trim();
  // If the model wrapped the code in a fenced block anyway, keep only its contents.
  const fenced = code.match(/```[\w-]*[ \t]*\r?\n([\s\S]*?)```/);
  if (fenced) code = fenced[1];
  code = code.replace(/```[\w-]*/g, "");
  // The preview has no module system: drop imports and export keywords.
  code = code
    .replace(/^\s*import\s[^;]*?from\s*["'][^"']+["'];?[ \t]*$/gm, "")
    .replace(/^\s*import\s+["'][^"']+["'];?[ \t]*$/gm, "")
    .replace(/^export\s+default\s+App;?[ \t]*$/gm, "")
    .replace(/^export\s+default\s+(?=(async\s+)?function\b|class\b)/gm, "")
    .replace(/^export\s+(?=(const|let|var|function|class)\b)/gm, "")
    // The preview shell renders App itself.
    .replace(/^(const\s+\w+\s*=\s*)?ReactDOM\.(createRoot|render)\(.*$/gm, "")
    .replace(/^root\.render\(.*$/gm, "");
  // The shell already declares useState and useEffect at the top level; a second
  // top-level declaration would be a SyntaxError, so drop those names from React destructures.
  code = code.replace(/^(const|let|var)\s*\{([^}]*)\}\s*=\s*React\s*;?[ \t]*$/gm, (_line, kind: string, names: string) => {
    const rest = names
      .split(",")
      .map((n) => n.trim())
      .filter((n) => n && n !== "useState" && n !== "useEffect");
    return rest.length ? `${kind} { ${rest.join(", ")} } = React;` : "";
  });
  return code.trim();
}
