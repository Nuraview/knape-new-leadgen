import { HTTPException } from "hono/http-exception";
import {
  AiNotConfigured,
  completeJson,
  isAiConfigured,
} from "../../proposal/ai/openai";
import { DRAFT_SCHEMA, findAngle, systemPrompt } from "./prompt";

/**
 * A first draft for the composer.
 *
 * Reuses the proposal module's OpenAI helper rather than adding a second way to
 * call the same API — it already handles strict JSON schema decoding, refusals,
 * truncation and the max_tokens/max_completion_tokens model split, and its "raw
 * fetch, no SDK" rule is load-bearing for the deploy image.
 *
 * Nothing here is saved. The text goes back to the browser and a person decides
 * what to do with it, which is the only honest way to ship AI copy into a feed
 * that has Dan's name on it.
 */

/** The model wraps output despite being told not to, often enough to strip. */
const STRIP_PREFIXES = [
  "here is your post:",
  "here's your post:",
  "here is the post:",
  "here's the post:",
  "post:",
];

export function cleanDraft(text: string): string {
  let out = (text ?? "").trim();

  const lowered = out.toLowerCase();
  for (const prefix of STRIP_PREFIXES) {
    if (lowered.startsWith(prefix)) {
      out = out.slice(prefix.length).trimStart();
      break;
    }
  }

  if (out.startsWith("```")) {
    out = out.slice(out.indexOf("\n") + 1);
    if (out.trimEnd().endsWith("```")) {
      out = out.trimEnd().slice(0, -3).trimEnd();
    }
  }

  // A post wrapped whole in quotes, not one that merely quotes someone.
  if (out.length > 1 && out.startsWith('"') && out.endsWith('"')) {
    if ((out.match(/"/g) ?? []).length === 2) out = out.slice(1, -1).trim();
  }

  // Cheap insurance against the one style rule the model breaks most often.
  out = out
    .replace(/ [—–] /g, ", ")
    .replace(/[—–]/g, "-");

  return out.slice(0, 3000);
}

export async function draftPost(
  topic: string,
  angleKey: string | null,
): Promise<{ post: string; model: string }> {
  const trimmed = (topic ?? "").trim();
  if (!trimmed) {
    throw new HTTPException(400, {
      message: "Say what the post should be about",
    });
  }
  if (trimmed.length > 2000) {
    throw new HTTPException(400, {
      message: "That brief is too long — trim it to the essentials",
    });
  }
  if (!isAiConfigured()) {
    // 503, not 500: the feature is fine, this deployment just has no key.
    throw new HTTPException(503, {
      message:
        "AI drafting is not configured — set OPENAI_API_KEY on this deployment. You can still write the post by hand.",
    });
  }

  const angle = findAngle(angleKey);
  const system = angle
    ? `${systemPrompt()}\n\nAngle for this post — ${angle.name}: ${angle.brief}`
    : systemPrompt();

  try {
    const result = await completeJson<{ post: string }>({
      system,
      user: JSON.stringify({ topic: trimmed, angle: angle?.key ?? null }),
      schemaName: "linkedin_post",
      schema: DRAFT_SCHEMA,
      maxOutputTokens: 2_000,
    });

    const post = cleanDraft(result.data.post);
    if (!post) {
      throw new HTTPException(502, {
        message: "The model returned an empty post — try rephrasing the topic",
      });
    }
    return { post, model: result.model };
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    if (error instanceof AiNotConfigured) {
      throw new HTTPException(503, { message: error.message });
    }
    throw new HTTPException(502, {
      message: `AI drafting failed: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}
