// components/code-view.tsx
// Client-only: imported from the Studio client boundary (clipboard access).

import { useMemo, useState } from "react";
import { Check, Copy } from "lucide-react";
import { highlight } from "sugar-high";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export function CodeView({ code }: { code: string }) {
  // sugar-high escapes <, > and & in every token, so untrusted model output can't inject markup.
  const html = useMemo(() => highlight(code), [code]);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      toast.success("Code copied");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Couldn't copy. Select the code and copy it manually.");
    }
  };

  return (
    <div className="relative size-full overflow-hidden rounded-xl border border-white/10 bg-neutral-950">
      <Button variant="secondary" size="sm" onClick={copy} className="absolute top-3 right-3 z-10">
        {copied ? <Check /> : <Copy />}
        {copied ? "Copied" : "Copy"}
      </Button>
      <pre className="code-view size-full overflow-auto p-5 pr-24 font-mono text-[13px] leading-relaxed">
        <code dangerouslySetInnerHTML={{ __html: html }} />
      </pre>
    </div>
  );
}
