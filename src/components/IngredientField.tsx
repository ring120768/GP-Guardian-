"use client";

// Inline editor for one ingredient field on the ingredients page — the name or the
// yield %. Saves when the chef leaves the box or presses Enter, and only if the value
// actually changed. Esc puts the last saved value back.
//
// One component for both fields (rather than a NameInput + YieldInput) because they
// behave identically; only the validation differs. The validation lives in here, not
// in a prop, because a server page can't pass a function to a client component.

import { useState } from "react";

type Field = "canonical_name" | "yield_percent";

/** Text in the box → the value to send, or an error for the chef. */
function parse(field: Field, text: string): { value: string | number } | { error: string } {
  const t = text.trim();
  if (field === "canonical_name") {
    return t === "" ? { error: "Name can't be blank" } : { value: t };
  }
  const n = Number(t);
  if (t === "" || !Number.isFinite(n) || n < 1 || n > 100) {
    return { error: "Yield must be between 1 and 100" };
  }
  return { value: n };
}

export function IngredientField({
  ingredientId,
  field,
  initial,
}: {
  ingredientId: string;
  field: Field;
  initial: string | number;
}) {
  const [text, setText] = useState(String(initial));
  const [saved, setSaved] = useState(initial); // last value the server accepted
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const parsed = parse(field, text);
    if ("error" in parsed) {
      setError(parsed.error);
      return;
    }
    if (parsed.value === saved) {
      setText(String(saved)); // tidy away trailing spaces etc.
      setError(null);
      return; // nothing changed — don't send a request
    }

    setState("saving");
    setError(null);
    try {
      const res = await fetch(`/api/ingredients/${ingredientId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: parsed.value }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) throw new Error(json.error ?? "Couldn't save.");
      setSaved(parsed.value);
      setText(String(parsed.value));
      setState("saved");
    } catch (err) {
      setError((err as Error).message);
      setState("idle");
    }
  }

  const isName = field === "canonical_name";

  return (
    <div>
      <div className="flex items-center gap-1">
        <input
          className={
            isName
              ? // Looks like plain text until hovered/focused, so the table stays readable.
                "w-full min-w-[10rem] rounded border border-transparent px-2 py-1 text-sm font-medium hover:border-neutral-300 focus:border-neutral-400"
              : "w-16 rounded border border-neutral-300 px-2 py-1 text-right text-sm"
          }
          inputMode={isName ? "text" : "decimal"}
          aria-label={isName ? "Ingredient name" : "Yield %"}
          value={text}
          disabled={state === "saving"}
          onChange={(e) => {
            setText(e.target.value);
            setState("idle");
          }}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
              setText(String(saved));
              setError(null);
            }
          }}
        />
        {!isName && <span className="text-sm text-neutral-500">%</span>}
        {state === "saved" && <span className="text-xs text-emerald-700">✓</span>}
      </div>
      {error && <p className="mt-0.5 text-xs text-red-600">{error}</p>}
    </div>
  );
}
