"use client";

// The lines on the review screen, as a checklist — plus the Confirm-all / Confirm-invoice
// buttons.
//
// Each line reads as ONE SENTENCE, like the paper invoice (describeLine), with [Confirm]
// and [Edit]. The input boxes only appear behind Edit — most lines are right, and a
// wall of inputs made checking them slow. A line that doesn't add up opens in edit mode
// by itself, so the problem is in front of the chef without them hunting for it.
//
// WHY ONE COMPONENT FOR THE WHOLE LIST (not one per line): the bulk buttons need to
// know whether ANY line has unsaved edits. "Confirm all" with a half-typed price still
// on screen would confirm the OLD price while the chef thinks they fixed it — so the
// bulk buttons are disabled until every edit is saved or undone.
//
// DRAFTS: we only store what the chef has TOUCHED, as the raw text they typed. Every
// other field shows the server's value, so when router.refresh() brings fresh data
// (after another line is saved), untouched fields update and half-typed ones survive.

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { InvoiceLine, PackUnit, PriceBasis } from "@/types/database";
import type { EditableField } from "@/lib/review/edit";
import { lineMathCheck } from "@/lib/review/checks";
import { describeLine } from "@/lib/review/describe";
import { parseWeight, formatWeightInput } from "@/lib/review/weight";

// The fields the chef types into. "weight" is ONE box standing in for the two columns
// unit_weight_min / unit_weight_max ("5" or "150-175") — see weight.ts.
type DraftField = Exclude<EditableField, "unit_weight_min" | "unit_weight_max"> | "weight";
type Draft = Partial<Record<DraftField, string>>;

const UNITS: { value: PackUnit; label: string }[] = [
  { value: "g", label: "g" },
  { value: "kg", label: "kg" },
  { value: "ml", label: "ml" },
  { value: "l", label: "L" }, // capital: "20l" reads as "201"
  { value: "unit", label: "each" },
];
const BASES: { value: PriceBasis | ""; label: string }[] = [
  // Kept: null is a real answer ("the invoice doesn't say"), and without this option a
  // null would display as "per pack" — a guess the chef never made.
  { value: "", label: "not stated" },
  { value: "per_pack", label: "per pack" },
  { value: "per_kg", label: "per kg" },
  { value: "per_litre", label: "per litre" },
  { value: "per_unit", label: "each" },
];

const asText = (v: unknown) => (v === null || v === undefined ? "" : String(v));

/** Text the chef typed → the value we'd store. Blank → null ("not stated", never 0). */
function parseNumber(
  field: DraftField,
  text: string
): { value: number | null } | { error: string } {
  const t = text.trim();
  if (t === "") return { value: null };
  const n = Number(t.replace(/^£/, ""));
  if (!Number.isFinite(n)) return { error: `"${text}" isn't a number` };
  if (field === "pack_count" && !Number.isInteger(n)) {
    return { error: "Pack count must be a whole number" };
  }
  return { value: n };
}

/** Parse a line's draft: which columns really changed, and any typing errors. */
function readDraft(line: InvoiceLine, draft: Draft) {
  const changed: Partial<Record<EditableField, unknown>> = {};
  const errors: string[] = [];
  const set = (field: EditableField, value: unknown) => {
    if (value !== line[field]) changed[field] = value;
  };

  for (const [field, text] of Object.entries(draft) as [DraftField, string][]) {
    if (field === "weight") {
      const w = parseWeight(text);
      if (!w.ok) errors.push(w.error);
      else {
        set("unit_weight_min", w.min);
        set("unit_weight_max", w.max);
      }
    } else if (field === "product_name_raw") {
      const name = text.trim();
      if (name === "") errors.push("Product name can't be blank");
      else set(field, name);
    } else if (field === "unit") {
      set(field, text);
    } else if (field === "price_basis") {
      set(field, text === "" ? null : text);
    } else {
      const parsed = parseNumber(field, text);
      if ("error" in parsed) errors.push(parsed.error);
      else set(field, parsed.value);
    }
  }
  return { changed, errors, dirty: Object.keys(changed).length > 0 || errors.length > 0 };
}

export function ReviewLines({
  documentId,
  lines,
  locked,
}: {
  documentId: string;
  lines: InvoiceLine[];
  /** True once the invoice is confirmed — everything read-only. */
  locked: boolean;
}) {
  const router = useRouter();
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  // Lines showing their edit fields. Starts with every unconfirmed line that doesn't
  // add up, so those are already open when the page loads.
  const [openIds, setOpenIds] = useState<Set<string>>(
    () =>
      new Set(
        locked
          ? []
          : lines.filter((l) => l.verified_at === null && !lineMathCheck(l).ok).map((l) => l.id)
      )
  );
  // The line currently asking "doesn't add up — confirm anyway?", if any.
  const [asking, setAsking] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // what's running, for the label
  const [error, setError] = useState<string | null>(null);

  const parsed = new Map(lines.map((l) => [l.id, readDraft(l, drafts[l.id] ?? {})]));
  const anyDirty = Array.from(parsed.values()).some((p) => p.dirty);
  const unverified = lines.filter((l) => l.verified_at === null);
  // Confirm-all only sweeps up lines that add up. A line that doesn't needs the chef to
  // look at it and say "confirm anyway" — a bulk button mustn't skip that question.
  const bulkConfirmable = unverified.filter((l) => lineMathCheck(l).ok);
  const needOneByOne = unverified.length - bulkConfirmable.length;

  function setField(lineId: string, field: DraftField, text: string) {
    setDrafts((d) => ({ ...d, [lineId]: { ...d[lineId], [field]: text } }));
  }
  function discard(lineId: string) {
    setDrafts(({ [lineId]: _, ...rest }) => rest);
  }
  function setOpen(lineId: string, open: boolean) {
    setOpenIds((ids) => {
      const next = new Set(ids);
      if (open) next.add(lineId);
      else next.delete(lineId);
      return next;
    });
  }

  async function patch(lineId: string, body: Record<string, unknown>) {
    const res = await fetch(`/api/invoice-lines/${lineId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.ok) throw new Error(json.error ?? "Couldn't save that line.");
  }

  /** Wraps an action: one thing at a time, errors shown, fresh data afterwards. */
  async function run(label: string, action: () => Promise<void>) {
    setBusy(label);
    setError(null);
    setAsking(null);
    try {
      await action();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
      router.refresh(); // re-read counts, % and verified_at from the server
    }
  }

  /** Save edits (if any), optionally confirming. Closes the line if it now adds up. */
  const save = (line: InvoiceLine, confirm: boolean) =>
    run(`line-${line.id}`, async () => {
      const { changed } = parsed.get(line.id)!;
      await patch(line.id, { ...changed, ...(confirm ? { confirm: true } : {}) });
      discard(line.id);
      if (lineMathCheck({ ...line, ...changed } as InvoiceLine).ok) setOpen(line.id, false);
    });

  /** Confirm — but if the line doesn't add up, ask first (inline, not a browser popup). */
  function requestConfirm(line: InvoiceLine) {
    const { changed } = parsed.get(line.id)!;
    if (!lineMathCheck({ ...line, ...changed } as InvoiceLine).ok && asking !== line.id) {
      setAsking(line.id);
      return;
    }
    save(line, true);
  }

  // ponytail: one PATCH per line, one after another — a few seconds on a long invoice.
  // Sequential on purpose: each request recounts lines_verified, and parallel recounts
  // could finish out of order. A bulk endpoint fixes it if it ever feels slow.
  const confirmAll = () =>
    run("all", async () => {
      for (const line of bulkConfirmable) await patch(line.id, { confirm: true });
    });

  const confirmInvoice = () =>
    run("invoice", async () => {
      const res = await fetch(`/api/documents/${documentId}/confirm`, { method: "POST" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) throw new Error(json.error ?? "Couldn't confirm the invoice.");
    });

  const input =
    "w-full rounded border border-neutral-300 px-2 py-1.5 text-sm disabled:bg-neutral-50";
  const button =
    "rounded border border-neutral-300 px-2.5 py-1 text-xs font-medium hover:bg-neutral-50 disabled:opacity-50";
  const primary =
    "rounded bg-neutral-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-neutral-800 disabled:opacity-50";

  return (
    <div>
      {error && (
        <p className="mb-3 rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <ul className="divide-y divide-neutral-100 rounded-lg border border-neutral-200 bg-white">
        {lines.map((line) => {
          const draft = drafts[line.id] ?? {};
          const { changed, errors, dirty } = parsed.get(line.id)!;
          // Everything below runs on what's ON SCREEN, so the sentence and the amber
          // note update as the chef types.
          const shown = { ...line, ...changed } as InvoiceLine;
          const check = lineMathCheck(shown);
          const verified = line.verified_at !== null && !dirty;
          const open = !locked && (openIds.has(line.id) || dirty);
          const disabled = locked || busy !== null;
          const value = (f: Exclude<DraftField, "weight">) => draft[f] ?? asText(line[f]);

          return (
            <li key={line.id} className={`p-3 ${verified ? "bg-emerald-50/50" : ""}`}>
              <div className="flex items-start justify-between gap-3">
                {/* break-words: long product names wrap instead of being cut off. */}
                <p className="min-w-0 break-words text-sm">{describeLine(shown)}</p>

                <div className="flex shrink-0 items-center gap-1.5">
                  {locked ? (
                    <span className="text-sm text-emerald-700">✓</span>
                  ) : dirty ? (
                    <>
                      <button
                        type="button"
                        onClick={() => requestConfirm(line)}
                        disabled={disabled || errors.length > 0}
                        className={primary}
                      >
                        Save &amp; confirm
                      </button>
                      <button
                        type="button"
                        onClick={() => save(line, false)}
                        disabled={disabled || errors.length > 0}
                        className={button}
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => discard(line.id)}
                        disabled={disabled}
                        className="px-1 text-xs text-neutral-500 hover:underline disabled:opacity-50"
                      >
                        Undo
                      </button>
                    </>
                  ) : (
                    <>
                      {verified ? (
                        <span className="text-xs font-medium text-emerald-700">✓ Confirmed</span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => requestConfirm(line)}
                          disabled={disabled}
                          className={primary}
                        >
                          {busy === `line-${line.id}` ? "…" : "Confirm"}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setOpen(line.id, !open)}
                        disabled={disabled}
                        className={button}
                        aria-expanded={open}
                      >
                        {open ? "Close" : "Edit"}
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Notes: typing errors, the sum not adding up, the supplier's own label. */}
              {(errors.length > 0 || !check.ok || line.status_note) && (
                <div className="mt-1 space-y-0.5 text-xs">
                  {errors.map((e) => (
                    <p key={e} className="text-red-600">
                      {e}
                    </p>
                  ))}
                  {!check.ok && <p className="text-amber-700">⚠ {check.message}</p>}
                  {line.status_note && <p className="text-neutral-500">Note: {line.status_note}</p>}
                </div>
              )}

              {asking === line.id && (
                <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  <span>This line doesn&apos;t add up — confirm anyway?</span>
                  <button
                    type="button"
                    onClick={() => save(line, true)}
                    disabled={busy !== null || errors.length > 0}
                    className={primary}
                  >
                    Confirm anyway
                  </button>
                  <button type="button" onClick={() => setAsking(null)} className={button}>
                    Cancel
                  </button>
                </div>
              )}

              {open && (
                <div className="mt-3 grid grid-cols-2 gap-3 rounded-md bg-neutral-50 p-3 sm:grid-cols-3">
                  <Field label="Product" className="col-span-2 sm:col-span-3">
                    <input
                      className={input}
                      value={value("product_name_raw")}
                      disabled={disabled}
                      onChange={(e) => setField(line.id, "product_name_raw", e.target.value)}
                    />
                  </Field>
                  <Field label="Qty ordered">
                    <input
                      className={input}
                      inputMode="decimal"
                      value={value("qty_ordered")}
                      disabled={disabled}
                      onChange={(e) => setField(line.id, "qty_ordered", e.target.value)}
                    />
                  </Field>
                  <Field label="Pack count">
                    <input
                      className={input}
                      inputMode="numeric"
                      value={value("pack_count")}
                      disabled={disabled}
                      onChange={(e) => setField(line.id, "pack_count", e.target.value)}
                    />
                  </Field>
                  <Field label="Weight (5 or 150-175)">
                    <div className="flex gap-1">
                      <input
                        className={input}
                        inputMode="decimal"
                        value={
                          draft.weight ??
                          formatWeightInput(line.unit_weight_min, line.unit_weight_max)
                        }
                        disabled={disabled}
                        onChange={(e) => setField(line.id, "weight", e.target.value)}
                      />
                      <select
                        className="w-20 shrink-0 rounded border border-neutral-300 px-1 py-1.5 text-sm"
                        aria-label="Unit"
                        value={value("unit")}
                        disabled={disabled}
                        onChange={(e) => setField(line.id, "unit", e.target.value)}
                      >
                        {UNITS.map((u) => (
                          <option key={u.value} value={u.value}>
                            {u.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </Field>
                  <Field label="Price per">
                    <select
                      className={input}
                      value={value("price_basis")}
                      disabled={disabled}
                      onChange={(e) => setField(line.id, "price_basis", e.target.value)}
                    >
                      {BASES.map((b) => (
                        <option key={b.value} value={b.value}>
                          {b.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Unit price £">
                    <input
                      className={input}
                      inputMode="decimal"
                      value={value("unit_price")}
                      disabled={disabled}
                      onChange={(e) => setField(line.id, "unit_price", e.target.value)}
                    />
                  </Field>
                  <Field label="Line total £">
                    <input
                      className={input}
                      inputMode="decimal"
                      value={value("total_price")}
                      disabled={disabled}
                      onChange={(e) => setField(line.id, "total_price", e.target.value)}
                    />
                  </Field>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {!locked && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={confirmAll}
            disabled={busy !== null || anyDirty || bulkConfirmable.length === 0}
            className="rounded-md border border-neutral-300 px-3 py-2 text-sm font-medium hover:bg-neutral-50 disabled:opacity-50"
          >
            {busy === "all"
              ? "Confirming…"
              : `Confirm all unconfirmed lines (${bulkConfirmable.length})`}
          </button>
          <button
            type="button"
            onClick={confirmInvoice}
            disabled={busy !== null || anyDirty || unverified.length > 0 || lines.length === 0}
            className="rounded-md bg-emerald-700 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
          >
            {busy === "invoice" ? "Confirming…" : "Confirm invoice"}
          </button>
          {anyDirty && (
            <span className="text-xs text-amber-700">Save or undo your edits first.</span>
          )}
          {!anyDirty && needOneByOne > 0 && (
            <span className="text-xs text-amber-700">
              {needOneByOne} {needOneByOne === 1 ? "line doesn't" : "lines don't"} add up — confirm{" "}
              {needOneByOne === 1 ? "it" : "them"} one at a time.
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  className = "",
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-0.5 block text-xs text-neutral-500">{label}</span>
      {children}
    </label>
  );
}
