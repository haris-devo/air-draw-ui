// lib/clean-code.test.ts
import { describe, expect, it } from "vitest";
import { cleanCode } from "./clean-code";

describe("cleanCode", () => {
  it("unwraps a fenced block and drops the prose around it", () => {
    const raw = "Here you go:\n```jsx\nfunction App() {\n  return <div />;\n}\n```\nEnjoy!";
    expect(cleanCode(raw)).toBe("function App() {\n  return <div />;\n}");
  });

  it("removes stray fences", () => {
    expect(cleanCode("```\nfunction App() { return null; }")).toBe("function App() { return null; }");
  });

  it("strips imports (including multi-line) and export keywords", () => {
    const raw = [
      'import React, { useState } from "react";',
      "import {",
      "  Button,",
      '} from "./button";',
      'import "./styles.css";',
      "export default function App() {",
      "  return <p>hi</p>;",
      "}",
    ].join("\n");
    expect(cleanCode(raw)).toBe("function App() {\n  return <p>hi</p>;\n}");
  });

  it("handles `export default App;` and exported consts", () => {
    expect(cleanCode("export const App = () => <div />;\nexport default App;")).toBe("const App = () => <div />;");
  });

  it("drops top-level useState/useEffect destructures that would clash with the preview shell", () => {
    expect(cleanCode("const { useState, useEffect } = React;\nfunction App() { return null; }")).toBe(
      "function App() { return null; }",
    );
    expect(cleanCode("const { useState, useRef } = React;\nfunction App() { return null; }")).toBe(
      "const { useRef } = React;\nfunction App() { return null; }",
    );
    // Inside a function it's a legal shadow, so leave it alone.
    const inner = "function App() {\n  const { useState } = React;\n  return null;\n}";
    expect(cleanCode(inner)).toBe(inner);
  });

  it("removes the model's own render call", () => {
    const raw = 'function App() { return null; }\nconst root = ReactDOM.createRoot(document.getElementById("root"));\nroot.render(<App />);';
    expect(cleanCode(raw)).toBe("function App() { return null; }");
    expect(cleanCode('function App() { return null; }\nReactDOM.createRoot(document.getElementById("root")).render(<App />);')).toBe(
      "function App() { return null; }",
    );
  });

  it("leaves plain code untouched", () => {
    const code = "function App() {\n  const [n, setN] = React.useState(0);\n  return <button onClick={() => setN(n + 1)}>{n}</button>;\n}";
    expect(cleanCode(code)).toBe(code);
  });

  it("returns empty for empty or fence-only output", () => {
    expect(cleanCode("")).toBe("");
    expect(cleanCode("```jsx\n```")).toBe("");
  });
});
