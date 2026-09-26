"use client";

// The rows of the Match ingredients queue, each with its four answers:
//   [Confirm]         → the suggested ingredient
//   [Choose…]         → search the existing ingredients
//   [New ingredient]  → name + unit + kind, created and matched in one go
//   [Not food]        → blue roll, cling film… tracked for price, never in a recipe
//
// Each row is independent (its own state), so answering one never disturbs another.
// After an answer, router.refresh() re-reads the queue: that row — and any other row
// the answer also covered — simply disappears.

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Ingredient, IngredientKind } from "@/types/database";
import type { Suggestion } from "@/lib/matching/match";

export interface MatchRowData {
  key: string;
  supplierId: string | null;
  supplierName: string;
  matchName: string;
  rawName: string;
  lineCount: number;
  latestPrice: string;
  suggestions: Suggestion[];
}

type IngredientOption = Pick<Ingredient, "id" | "canonical_name" | "kind">;

const KIND_LABELS: Record<IngredientKind, string> = {
  food: "Food",
  non_food: "Not food",
  by_product: "By-product (trim, bones)",
};

export function MatchQueue({
  rows,
  ingredients,
}: {
  rows: MatchRowData[];
  ingredients: IngredientOption[];
}) {
  return (
    <ul className="max-w-3xl space-y-2">
      {rows.map((row) => (
        <MatchRow key={row.key} row={row} ingredients={ingredients} />
      ))}
    </ul>
  );
}

type Action =
  | { type: "existing"; ingredientId: string; fromSuggestion: boolean }
  | { type: "new"; name: string; defaultUnit: "g" | "ml" | "unit"; kind: IngredientKind }
  | { type: "not_food" };

function MatchRow({ row, ingredients }: { row: MatchRowData; ingredients: IngredientOption[] }) {
  const router = useRouter();
  const [mode, setMode] = useState<"idle" | "choose" | "new">("idle");
  const [search, setSearch] = useState("");
  // New-ingredient form, pre-filled from the product in sentence case:
  // "CHIX SUPREME SKIN-ON 150-175G" → "Chix supreme skin-on". Supplier shorthand ("chix")
  // is left as-is on purpose — only the chef knows what it should say.
  const [newName, setNewName] = useState(
    row.matchName.charAt(0).toUpperCase() + row.matchName.slice(1)
  );
  const [newUnit, setNewUnit] = useState<"g" | "ml" | "unit">("g");
  const [newKind, setNewKind] = useState<IngredientKind>("food");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const top = row.suggestions[0];

  async function answer(action: Action) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/ingredients/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ supplierId: row.supplierId, matchName: row.matchName, action }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) throw new Error(json.error ?? "Couldn't save that match.");
      router.refresh(); // this row (and the nav badge) update from the server
      // No setBusy(false): the row is about to disappear.
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  // Search the existing ingredients: suggestions first, then name matches. Capped so a
  // big ingredient list doesn't turn this into a wall.
  const q = search.trim().toLowerCase();
  const suggestedIds = new Set(row.suggestions.map((s) => s.ingredientId));
  const choices = [
    ...ingredients.filter((i) => suggestedIds.has(i.id)),
    ...ingredients.filter((i) => !suggestedIds.has(i.id)),
  ]
    .filter((i) => q === "" || i.canonical_name.toLowerCase().includes(q))
    .slice(0, 8);

  const button =
    "rounded-md border border-neutral-300 px-2.5 py-1 text-xs font-medium hover:bg-neutral-50 disabled:opacity-50";
  const input = "rounded-md border border-neutral-300 px-2 py-1.5 text-sm";

  return (
    <li className="rounded-lg border border-neutral-200 bg-white p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="break-words text-sm font-medium">{row.rawName}</p>
          <p className="text-xs text-neutral-500">
            {row.supplierName} · {row.lineCount} {row.lineCount === 1 ? "line" : "lines"} · latest{" "}
            {row.latestPrice}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {top && (
            <>
              <span className="text-xs text-neutral-500">
                →{" "}
                <span
                  className={
                    top.confidence === "low" ? "text-neutral-500" : "font-medium text-neutral-900"
                  }
                >
                  {top.name}
                </span>
                {top.confidence === "low" && "?"}
              </span>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  answer({ type: "existing", ingredientId: top.ingredientId, fromSuggestion: true })
                }
                className="rounded-md bg-neutral-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
              >
                Confirm
              </button>
            </>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() => setMode(mode === "choose" ? "idle" : "choose")}
            className={button}
            aria-expanded={mode === "choose"}
          >
            Choose…
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => setMode(mode === "new" ? "idle" : "new")}
            className={button}
            aria-expanded={mode === "new"}
          >
            New ingredient
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => answer({ type: "not_food" })}
            className={button}
          >
            Not food
          </button>
        </div>
      </div>

      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

      {mode === "choose" && (
        <div className="mt-3 rounded-md bg-neutral-50 p-3">
          <input
            autoFocus
            className={`${input} w-full`}
            placeholder="Search ingredients…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {choices.length === 0 ? (
            <p className="mt-2 text-xs text-neutral-500">
              No ingredient called that yet — use New ingredient.
            </p>
          ) : (
            <ul className="mt-2 space-y-1">
              {choices.map((ing) => (
                <li key={ing.id}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      answer({ type: "existing", ingredientId: ing.id, fromSuggestion: false })
                    }
                    className="w-full rounded px-2 py-1 text-left text-sm hover:bg-white disabled:opacity-50"
                  >
                    {ing.canonical_name}
                    {ing.kind !== "food" && (
                      <span className="ml-2 text-xs text-neutral-400">{KIND_LABELS[ing.kind]}</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {mode === "new" && (
        <form
          className="mt-3 flex flex-wrap items-end gap-2 rounded-md bg-neutral-50 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            answer({ type: "new", name: newName, defaultUnit: newUnit, kind: newKind });
          }}
        >
          <label className="flex-1">
            <span className="mb-0.5 block text-xs text-neutral-500">
              Name <span className="text-neutral-400">— tidy up the supplier&apos;s wording</span>
            </span>
            {/* Focused with the text selected: it's obviously editable, typing replaces
                it, and one click puts the cursor in to fix just the "chix". */}
            <input
              autoFocus
              onFocus={(e) => e.currentTarget.select()}
              className={`${input} w-full`}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
          </label>
          <label>
            <span className="mb-0.5 block text-xs text-neutral-500">Measured in</span>
            <select
              className={input}
              value={newUnit}
              onChange={(e) => setNewUnit(e.target.value as typeof newUnit)}
            >
              <option value="g">g</option>
              <option value="ml">ml</option>
              <option value="unit">each</option>
            </select>
          </label>
          <label>
            <span className="mb-0.5 block text-xs text-neutral-500">Kind</span>
            <select
              className={input}
              value={newKind}
              onChange={(e) => setNewKind(e.target.value as IngredientKind)}
            >
              {(Object.keys(KIND_LABELS) as IngredientKind[]).map((k) => (
                <option key={k} value={k}>
                  {KIND_LABELS[k]}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            disabled={busy || newName.trim() === ""}
            className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
          >
            {busy ? "Saving…" : "Create & match"}
          </button>
        </form>
      )}
    </li>
  );
}
