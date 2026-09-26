"use client";

// The editable lines table on the review screen, plus the Confirm-all / Confirm-invoice
// buttons.
//
// WHY ONE COMPONENT FOR THE WHOLE TABLE (not one per row): the bulk buttons need to
// know whether ANY row has unsaved edits. "Confirm all" with a half-typed price still
// on screen would confirm the OLD price while the chef thinks they fixed it — so the
// bulk buttons are disabled until every edit is saved or discarded. That needs all the
// drafts in one place.
//
// DRAFTS: we only store what the chef has TOUCHED, as the raw text they typed. Every
// other cell shows the server's value. So when router.refresh() brings fresh data
// (after another row is saved), untouched cells update and half-typed ones survive.

import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import type { InvoiceLine, PackUnit, PriceBasis } from "@/types/database";
import { EDITABLE_FIELDS, type EditableField } from "@/lib/review/edit";
import { lineMathCheck } from "@/lib/review/checks";

type Draft = Partial<Record<EditableField, string>>;

const UNITS: PackUnit[] = ["g", "kg", "ml", "l", "unit"];
const BASES: { value: PriceBasis | ""; label: string }[] = [
  { value: "", label: "not stated" },
  { value: "per_pack", label: "per pack" },
  { value: "per_kg", label: "per kg" },
  { value: "per_litre", label: "per litre" },
  { value: "per_unit", label: "per unit" },
];
const NUMERIC_FIELDS = new Set<EditableField>([
  "qty_ordered",
  "pack_count",
  "unit_weight_min",
  "unit_weight_max",
  "unit_price",
  "total_price",
]);

const asText = (v: unknown) => (v === null || v === undefined ? "" : String(v));

/** Text the chef typed → the value we'd store. Blank → null ("not stated", never 0). */
function parseField(field: EditableField, text: string): { value: unknown } | { error: string } {
  const t = text.trim();
  if (field === "product_name_raw") return { value: t };
  if (field === "unit") return { value: t };
  if (field === "price_basis") return { value: t === "" ? null : t };
  if (t === "") return { value: null };
  const n = Number(t.replace(/^£/, ""));
  if (!Number.isFinite(n)) return { error: `"${text}" isn't a number` };
  if (field === "pack_count" && !Number.isInteger(n)) {
    return { error: "Pack count must be a whole number" };
  }
  return { value: n };
}

/** Parse a row's draft: which fields really changed, and any typing errors. */
function readDraft(line: InvoiceLine, draft: Draft) {
  const changed: Partial<Record<EditableField, unknown>> = {};
  const errors: string[] = [];
  for (const field of EDITABLE_FIELDS) {
    const text = draft[field];
    if (text === undefined) continue;
    const parsed = parseField(field, text);
    if ("error" in parsed) errors.push(parsed.error);
    else if (parsed.value !== line[field]) changed[field] = parsed.value;
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
  const [busy, setBusy] = useState<string | null>(null); // what's running, for the label
  const [error, setError] = useState<string | null>(null);

  const parsed = new Map(lines.map((l) => [l.id, readDraft(l, drafts[l.id] ?? {})]));
  const anyDirty = Array.from(parsed.values()).some((p) => p.dirty);
  const unverified = lines.filter((l) => l.verified_at === null);

  function setField(lineId: string, field: EditableField, text: string) {
    setDrafts((d) => ({ ...d, [lineId]: { ...d[lineId], [field]: text } }));
  }
  function discard(lineId: string) {
    setDrafts(({ [lineId]: _, ...rest }) => rest);
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
    try {
      await action();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
      router.refresh(); // re-read counts, % and verified_at from the server
    }
  }

  const saveLine = (line: InvoiceLine, confirm: boolean) =>
    run(`line-${line.id}`, async () => {
      const { changed } = parsed.get(line.id)!;
      await patch(line.id, { ...changed, ...(confirm ? { confirm: true } : {}) });
      discard(line.id);
    });

  // ponytail: one PATCH per line, one after another — a few seconds on a long invoice.
  // Sequential on purpose: each request recounts lines_verified, and parallel recounts
  // could finish out of order. A bulk endpoint fixes it if it ever feels slow.
  const confirmAll = () =>
    run("all", async () => {
      for (const line of unverified) await patch(line.id, { confirm: true });
    });

  const confirmInvoice = () =>
    run("invoice", async () => {
      const res = await fetch(`/api/documents/${documentId}/confirm`, { method: "POST" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) throw new Error(json.error ?? "Couldn't confirm the invoice.");
    });

  const input =
    "w-full rounded border border-neutral-300 px-1.5 py-1 text-xs disabled:bg-transparent disabled:border-transparent";

  return (
    <div>
      {error && (
        <p className="mb-3 rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
        <table className="w-full text-xs">
          <thead className="border-b border-neutral-200 text-left text-neutral-500">
            <tr>
              <th className="px-2 py-2 font-medium">Product</th>
              <th className="px-2 py-2 font-medium">Qty</th>
              <th className="px-2 py-2 font-medium">Pack</th>
              <th className="px-2 py-2 font-medium">Wt min</th>
              <th className="px-2 py-2 font-medium">Wt max</th>
              <th className="px-2 py-2 font-medium">Unit</th>
              <th className="px-2 py-2 font-medium">Price per</th>
              <th className="px-2 py-2 font-medium">Unit £</th>
              <th className="px-2 py-2 font-medium">Total £</th>
              <th className="px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => {
              const draft = drafts[line.id] ?? {};
              const { changed, errors, dirty } = parsed.get(line.id)!;
              const value = (f: EditableField) => draft[f] ?? asText(line[f]);
              // Run the sum on what's ON SCREEN, so the note updates as the chef types.
              const check = lineMathCheck({ ...line, ...changed } as InvoiceLine);
              const verified = line.verified_at !== null && !dirty;
              const disabled = locked || busy !== null;

              const numberCell = (f: EditableField, width = "w-16") => (
                <td className="px-1 py-1">
                  <input
                    className={`${input} ${width} text-right`}
                    inputMode="decimal"
                    value={value(f)}
                    disabled={disabled}
                    onChange={(e) => setField(line.id, f, e.target.value)}
                  />
                </td>
              );

              return (
                <Fragment key={line.id}>
                  <tr
                    className={`border-t border-neutral-100 ${verified ? "bg-emerald-50/50" : ""}`}
                  >
                    <td className="px-1 py-1">
                      <input
                        className={`${input} min-w-[12rem]`}
                        value={value("product_name_raw")}
                        disabled={disabled}
                        onChange={(e) => setField(line.id, "product_name_raw", e.target.value)}
                      />
                    </td>
                    {numberCell("qty_ordered", "w-12")}
                    {numberCell("pack_count", "w-12")}
                    {numberCell("unit_weight_min")}
                    {numberCell("unit_weight_max")}
                    <td className="px-1 py-1">
                      <select
                        className={input}
                        value={value("unit")}
                        disabled={disabled}
                        onChange={(e) => setField(line.id, "unit", e.target.value)}
                      >
                        {UNITS.map((u) => (
                          <option key={u}>{u}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-1 py-1">
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
                    </td>
                    {numberCell("unit_price", "w-20")}
                    {numberCell("total_price", "w-20")}
                    <td className="whitespace-nowrap px-2 py-1 text-right">
                      {locked ? (
                        <span className="text-emerald-700">✓</span>
                      ) : dirty ? (
                        <span className="flex gap-1">
                          <button
                            type="button"
                            onClick={() => saveLine(line, true)}
                            disabled={disabled || errors.length > 0}
                            className="rounded bg-neutral-900 px-2 py-1 font-medium text-white disabled:opacity-50"
                          >
                            Save &amp; confirm
                          </button>
                          <button
                            type="button"
                            onClick={() => saveLine(line, false)}
                            disabled={disabled || errors.length > 0}
                            className="rounded border border-neutral-300 px-2 py-1 disabled:opacity-50"
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            onClick={() => discard(line.id)}
                            disabled={disabled}
                            className="px-1 text-neutral-500 hover:underline disabled:opacity-50"
                          >
                            Undo
                          </button>
                        </span>
                      ) : verified ? (
                        <span className="text-emerald-700">✓ Confirmed</span>
                      ) : (
                        <button
                          type="button"
                          onClick={() =>
                            run(`line-${line.id}`, () => patch(line.id, { confirm: true }))
                          }
                          disabled={disabled}
                          className="rounded border border-neutral-300 px-2 py-1 font-medium hover:bg-neutral-50 disabled:opacity-50"
                        >
                          {busy === `line-${line.id}` ? "…" : "Confirm"}
                        </button>
                      )}
                    </td>
                  </tr>
                  {(errors.length > 0 || !check.ok || line.status_note) && (
                    <tr>
                      <td colSpan={10} className="space-y-0.5 px-2 pb-2">
                        {errors.map((e) => (
                          <p key={e} className="text-red-600">
                            {e}
                          </p>
                        ))}
                        {!check.ok && <p className="text-amber-700">⚠ {check.message}</p>}
                        {line.status_note && (
                          <p className="text-neutral-500">Note: {line.status_note}</p>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {!locked && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={confirmAll}
            disabled={busy !== null || anyDirty || unverified.length === 0}
            className="rounded-md border border-neutral-300 px-3 py-2 text-sm font-medium hover:bg-neutral-50 disabled:opacity-50"
          >
            {busy === "all"
              ? "Confirming…"
              : `Confirm all unconfirmed lines (${unverified.length})`}
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
        </div>
      )}
    </div>
  );
}
