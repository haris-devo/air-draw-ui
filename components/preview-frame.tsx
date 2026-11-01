// components/preview-frame.tsx
// Client-only: imported from the Studio client boundary (listens for iframe postMessage).

import { useEffect, useMemo, useRef } from "react";

// crossorigin keeps error messages readable (not "Script error.") across origins.
// Exact versions, so a CDN release can never change what the preview runs.
const TAILWIND = "https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4.3.3/dist/index.global.js";
const REACT = "https://cdn.jsdelivr.net/npm/react@18.3.1/umd/react.production.min.js";
const REACT_DOM = "https://cdn.jsdelivr.net/npm/react-dom@18.3.1/umd/react-dom.production.min.js";
const BABEL = "https://cdn.jsdelivr.net/npm/@babel/standalone@7.29.10/babel.min.js";
const RENDER_TIMEOUT_MS = 15_000;

export type PreviewMessage = { source: "air-draw-preview"; runId: string } & (
  | { type: "ok" }
  | { type: "error"; message: string }
);

/** Escapes sequences that would end the inline <script> early or flip the HTML parser's script state. */
function escapeForScript(code: string) {
  return code.replace(/<\/script/gi, "<\\/script").replace(/<!--/g, "<\\!--");
}

export function buildSrcDoc(code: string, runId: string) {
  const id = JSON.stringify(runId);
  return `<!doctype html>
<html class="h-full">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<script src="${TAILWIND}" crossorigin></script>
<script src="${REACT}" crossorigin></script>
<script src="${REACT_DOM}" crossorigin></script>
<script src="${BABEL}" crossorigin></script>
<script>
  (function () {
    var failed = false, rendered = false;
    function post(msg) { parent.postMessage(Object.assign({ source: "air-draw-preview", runId: ${id} }, msg), "*"); }
    window.__report = function (err) {
      if (failed) return;
      failed = true;
      post({ type: "error", message: String((err && (err.message || err.reason)) || err || "Unknown error") });
    };
    window.__ok = function () { if (!failed && !rendered) { rendered = true; post({ type: "ok" }); } };
    // Global errors only count until the first successful render; after that a failing click
    // handler leaves the UI intact. Render crashes always count (the error boundary reports them).
    window.addEventListener("error", function (e) { if (!rendered) window.__report(e.error || e.message); });
    window.addEventListener("unhandledrejection", function (e) { if (!rendered) window.__report(e.reason); });
    // Forms can't submit in a sandbox without allow-forms, so fire the submit event ourselves
    // to keep generated onSubmit handlers working.
    document.addEventListener("click", function (e) {
      var btn = e.target && e.target.closest && e.target.closest("button, input[type=submit]");
      var form = btn && btn.form;
      if (!form || (btn.type && btn.type !== "submit")) return;
      e.preventDefault();
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    }, true);
    window.__Boundary = class extends React.Component {
      componentDidCatch(error) { window.__report(error); }
      static getDerivedStateFromError() { return { failed: true }; }
      render() { return this.state && this.state.failed ? null : this.props.children; }
    };
  })();
</script>
<style>html, body, #root { min-height: 100%; } body { margin: 0; background: #f7f8fb radial-gradient(#d5dbe5 1px, transparent 1px) 0 0 / 20px 20px; }</style>
</head>
<body class="h-full text-neutral-900 antialiased">
<div id="root" class="grid min-h-full place-items-center p-6"></div>
<script type="text/babel" data-presets="react">
const { useState, useEffect } = React;
${escapeForScript(code)}
if (typeof App === "undefined") throw new Error("The generated code has no App component.");
// Ready's effect runs after App's first commit; rAF would stall while the tab is hidden.
function __Ready() { useEffect(() => window.__ok(), []); return null; }
ReactDOM.createRoot(document.getElementById("root")).render(<window.__Boundary><App /><__Ready /></window.__Boundary>);
</script>
</body>
</html>`;
}

type Props = {
  code: string;
  runId: string;
  onResult: (result: { ok: true } | { ok: false; message: string }) => void;
};

export function PreviewFrame({ code, runId, onResult }: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const srcDoc = useMemo(() => buildSrcDoc(code, runId), [code, runId]);
  const onResultRef = useRef(onResult);
  useEffect(() => {
    onResultRef.current = onResult;
  });

  useEffect(() => {
    // A CDN that never loads or code that hangs would otherwise leave the preview spinning forever.
    const timeout = setTimeout(
      () => onResultRef.current({ ok: false, message: "The preview took too long to render." }),
      RENDER_TIMEOUT_MS,
    );
    const onMessage = (event: MessageEvent<PreviewMessage>) => {
      // The sandboxed frame has an opaque origin, so match on the window and run id instead.
      if (event.source !== iframeRef.current?.contentWindow) return;
      const data = event.data;
      if (data?.source !== "air-draw-preview" || data.runId !== runId) return;
      clearTimeout(timeout);
      onResultRef.current(data.type === "ok" ? { ok: true } : { ok: false, message: data.message });
    };
    window.addEventListener("message", onMessage);
    return () => {
      clearTimeout(timeout);
      window.removeEventListener("message", onMessage);
    };
  }, [runId]);

  return (
    <iframe
      ref={iframeRef}
      title="Generated component preview"
      // Model output is untrusted: scripts only, never same-origin.
      sandbox="allow-scripts"
      srcDoc={srcDoc}
      className="size-full"
    />
  );
}
