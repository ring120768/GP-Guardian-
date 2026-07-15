// The Anthropic API call — turns invoice bytes into a validated ExtractedInvoice.
//
// Deliberately knows NOTHING about Supabase or our tables. Its only job is:
//   (file bytes + format + known aliases) → validated structured invoice, or throw.
// The DB orchestration lives in pipeline.ts. Keeping the AI call pure like this means
// it's testable in isolation and there's exactly one place that talks to Anthropic.
//
// SERVER ONLY. This reads ANTHROPIC_API_KEY. It must never be imported into a client
// component or the key would ship to the browser. (Route handlers / server actions only.)

import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import {
  ExtractedInvoiceSchema,
  type ExtractedInvoice,
} from "./schema";
import {
  buildExtractionSystemPrompt,
  EXTRACTION_USER_INSTRUCTION,
} from "./prompt";
import type { SourceFormat } from "@/types/database";

// Opus 4.8 — strong vision + structured output, and its 1M context comfortably fits a
// multi-page PDF. We don't downgrade for cost here: misreading an invoice is far more
// expensive than the tokens. (If cost ever bites, Haiku is the lever — but that's a
// deliberate call to make later, not a default.)
const MODEL = "claude-opus-4-8";

// Media type Anthropic expects for a photo, from our stored source_format + the file's
// own type. We validated the upload down to jpeg/png/webp/pdf, so this stays small.
function imageMediaType(mime: string): "image/jpeg" | "image/png" | "image/webp" {
  if (mime === "image/png") return "image/png";
  if (mime === "image/webp") return "image/webp";
  return "image/jpeg"; // default; covers image/jpeg
}

export interface ExtractInput {
  /** Raw file bytes pulled from Supabase Storage. */
  bytes: Buffer;
  /** MIME type as stored on upload (e.g. "application/pdf", "image/jpeg"). */
  mimeType: string;
  /** 'photo' | 'pdf' — decides image block vs document block (design doc §5). */
  sourceFormat: SourceFormat;
  /** This venue's known raw product strings, fed to the prompt for better recognition (§3). */
  knownAliases: string[];
}

/**
 * Calls Anthropic and returns a schema-validated invoice. Throws on API failure or if
 * the response somehow can't be validated — the caller turns a throw into
 * processing_status = 'failed' + a chef-readable extraction_error.
 */
export async function extractInvoice(input: ExtractInput): Promise<ExtractedInvoice> {
  // Zero-arg client: reads ANTHROPIC_API_KEY from the environment.
  const client = new Anthropic();

  // Base64 with no newlines — Anthropic requires clean base64 for document/image data.
  // Buffer.toString("base64") already produces newline-free output.
  const base64 = input.bytes.toString("base64");

  // Route PDF vs photo (design doc §5). Both paths produce the SAME structured output,
  // so everything downstream is identical.
  //
  //  • PDF  → a `document` block. Anthropic's PDF support reads the embedded text layer
  //           AND falls back to vision on scanned/image-only pages internally — which is
  //           exactly the "text-layer first, OCR/vision fallback" routing the design doc
  //           describes, handled for us in one call.
  //  • photo → an `image` block (vision).
  const mediaBlock =
    input.sourceFormat === "pdf"
      ? ({
          type: "document" as const,
          source: {
            type: "base64" as const,
            media_type: "application/pdf" as const,
            data: base64,
          },
        })
      : ({
          type: "image" as const,
          source: {
            type: "base64" as const,
            media_type: imageMediaType(input.mimeType),
            data: base64,
          },
        });

  // messages.parse() enforces the schema at the API layer and hands back a typed,
  // validated object on `parsed_output` (null if the model refused or output was cut off).
  const response = await client.messages.parse({
    model: MODEL,
    max_tokens: 8192, // an invoice's worth of structured lines fits comfortably
    system: buildExtractionSystemPrompt(input.knownAliases),
    messages: [
      {
        role: "user",
        // Media block BEFORE the text instruction — the recommended ordering for
        // document/image inputs.
        content: [mediaBlock, { type: "text", text: EXTRACTION_USER_INSTRUCTION }],
      },
    ],
    output_config: { format: zodOutputFormat(ExtractedInvoiceSchema) },
  });

  if (response.stop_reason === "refusal") {
    throw new Error("The AI declined to read this document.");
  }
  if (!response.parsed_output) {
    // max_tokens hit, or validation failed — either way we don't have a trustworthy
    // result, so we refuse to pretend we do.
    throw new Error("Couldn't read a valid invoice from this document — try a clearer photo.");
  }

  return response.parsed_output;
}
