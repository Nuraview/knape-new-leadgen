/**
 * Read a fetch Response as JSON without letting a non-JSON body swallow the
 * real error.
 *
 * The obvious shape is wrong in a way that only shows up in production:
 *
 *   const data = await response.json();   // throws HERE on an error body
 *   if (!response.ok) throw new Error(data.error);
 *
 * The API's 403 gate (require-crm-access) throws a Hono HTTPException, and
 * Hono serialises that as PLAIN TEXT, not JSON. So `response.json()` rejected
 * before the `!ok` branch could read the message, and an operator trying to
 * send outreach saw
 *
 *   Failed to execute 'json' on 'Response': Unexpected token 'T',
 *   "This accou"... is not valid JSON
 *
 * instead of "This account does not have CRM access. Ask an admin if you need
 * leads." — an actionable sentence turned into a parser error, on a screen with
 * no other clue. Any upstream that returns text (a proxy 502, an nginx error
 * page, a rate limiter) produced the same nonsense.
 *
 * Reading the body as text FIRST and parsing second means the status check
 * always gets to run, and a non-JSON body degrades to its own text as the
 * message rather than to a stack trace about tokens.
 */
export async function readJsonResponse<T>(response: Response): Promise<T> {
  const raw = await response.text();

  let parsed: unknown;
  try {
    parsed = raw ? JSON.parse(raw) : {};
  } catch {
    parsed = undefined;
  }

  if (!response.ok) {
    const fromJson =
      parsed && typeof parsed === "object"
        ? ((parsed as { error?: string; detail?: string; message?: string })
            .error ??
          (parsed as { detail?: string }).detail ??
          (parsed as { message?: string }).message)
        : undefined;

    // Falls back to the raw body, which is exactly where the useful sentence
    // lives when the responder did not speak JSON. Trimmed so a stray newline
    // does not render as an empty toast.
    const message = fromJson || raw.trim() || `Error ${response.status}`;
    throw new Error(message);
  }

  if (parsed === undefined) {
    throw new Error("The server returned a response that could not be read.");
  }

  return parsed as T;
}
