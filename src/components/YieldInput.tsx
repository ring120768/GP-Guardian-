"use client";

// Inline yield % editor on the ingredients page. Saves when the chef leaves the box or
// presses Enter, and only if the number actually changed.
//
// 100 = off. Only change it for in-house butchery/filleting (CLAUDE.md "Money rules").

import { useState } from "react";

export function YieldInput({ ingredientId, initial }: { ingredientId: string; initial: number }) {
  const [text, setText] = useState(String(initial));
  const [saved, setSaved] = useState(initial); // last value the server accepted
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const value = Number(text.trim());
    if (text.trim() === "" || !Number.isFinite(value) || value < 1 || value > 100) {
      setError("Yield must be between 1 and 100");
      return;
    }
    if (value === saved) {
      setError(null);
      return; // nothing changed — don't send a request
    }

    setState("saving");
    setError(null);
    try {
      const res = await fetch(`/api/ingredients/${ingredientId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ yield_percent: value }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) throw new Error(json.error ?? "Couldn't save.");
      setSaved(value);
      setState("saved");
    } catch (err) {
      setError((err as Error).message);
      setState("idle");
    }
  }

  return (
    <div>
      <div className="flex items-center gap-1">
        <input
          className="w-16 rounded border border-neutral-300 px-2 py-1 text-right text-sm"
          inputMode="decimal"
          aria-label="Yield %"
          value={text}
          disabled={state === "saving"}
          onChange={(e) => {
            setText(e.target.value);
            setState("idle");
          }}
          onBlur={save}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        />
        <span className="text-sm text-neutral-500">%</span>
        {state === "saved" && <span className="text-xs text-emerald-700">✓</span>}
      </div>
      {error && <p className="mt-0.5 text-xs text-red-600">{error}</p>}
    </div>
  );
}
