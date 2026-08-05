/**
 * The in-app assistant — DeepSeek, with tools, server-side.
 *
 * Answers questions about THIS instance's live data rather than in general:
 * "who should I call today", "why is nothing sending", "how many leads did we
 * find". It is the thing that turns a dashboard full of numbers into an answer,
 * which is the whole complaint it exists to fix.
 *
 * WHY THE MODEL NEVER RUNS IN THE BROWSER
 *
 * DEEPSEEK_API_KEY stays in this process. A key shipped to the client is a key
 * anyone can lift out of the bundle and spend, and this one is billed per
 * token. Same reasoning as the lead-gen proxy: one origin, secrets server-side.
 *
 * WHY THE TOOLS ARE READ-ONLY
 *
 * Every tool is a GET through cockpitGet(), which is allow-listed — a tool
 * cannot reach anything the browser could not, and POST /api/sync (which begins
 * DELETE FROM accounts) is unreachable by construction. An assistant that can
 * be talked into sending 500 emails or wiping the accounts table is not a
 * feature. If it should ever act rather than advise, that is a deliberate
 * addition with its own confirmation step, not a widened allow-list.
 */
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { cockpitGet, cockpitPost } from "../leadgen";
import { requireCrmAccess } from "../utils/require-crm-access";
import getBrand from "../utils/get-brand";

const DEEPSEEK_BASE = "https://api.deepseek.com";
const MODEL = process.env.DEEPSEEK_MODEL?.trim() || "deepseek-v4-flash";

function apiKey(): string {
  const key = process.env.DEEPSEEK_API_KEY?.trim();
  if (!key) {
    throw new HTTPException(503, {
      message:
        "The assistant is not configured — set DEEPSEEK_API_KEY on this deployment.",
    });
  }
  return key;
}

/* ----------------------------------------------------------------- tools -- */

type ToolResult = Record<string, unknown>;

/**
 * What the assistant can look up.
 *
 * Deliberately few and deliberately coarse. One tool per question a human
 * actually asks, each returning a small, already-summarised object — handing a
 * model 2,000 raw lead rows and hoping it aggregates them correctly is slower,
 * costlier and less reliable than letting Postgres do the counting.
 */
const TOOLS: Record<
  string,
  { description: string; parameters: Record<string, unknown>; run: (args: Record<string, unknown>) => Promise<ToolResult> }
> = {
  get_outreach_overview: {
    description:
      "Email performance for the last N days: sent, delivered, opened, clicked, bounced and their rates. Use for 'how is the campaign doing'.",
    parameters: {
      type: "object",
      properties: {
        days: { type: "integer", description: "Window in days, default 7" },
      },
    },
    run: async (args) => {
      const days = Number(args.days ?? 7);
      const stats = await cockpitGet<Record<string, unknown>>(
        `/api/emails/stats?days=${Number.isFinite(days) ? days : 7}`,
      );
      return { window: stats.window, cap_remaining: stats.cap_remaining };
    },
  },

  get_who_to_contact: {
    description:
      "Organisations that opened or clicked an email and have not replied — the warm call list, with names and addresses. Use for 'who should I call' or 'who is interested'.",
    parameters: { type: "object", properties: {} },
    run: async () => {
      const a = await cockpitGet<Record<string, ToolResult>>(
        "/api/emails/attention?limit=10",
      );
      return {
        clicked_no_reply: a.warm?.count ?? 0,
        opened_no_click: a.opened?.count ?? 0,
        replies_waiting: a.replies?.count ?? 0,
        top_leads: a.warm?.items ?? [],
      };
    },
  },

  get_pipeline_status: {
    description:
      "Lead-finding state: whether the scraper is running or scheduled, when it last ran, how many leads it found today, and totals. Use for 'is scraping working' or 'how many leads do we have'.",
    parameters: { type: "object", properties: {} },
    run: async () => {
      const s = await cockpitGet<Record<string, unknown>>("/api/pipeline/status");
      return {
        running: s.running,
        stage: s.stage,
        schedule: s.schedule,
        yield: s.yield,
      };
    },
  },

  get_send_readiness: {
    description:
      "Whether anything can be sent right now: the pool of contactable people, the 24h send cap remaining, and the funnel explaining why the pool is the size it is. Use for 'why is nothing sending' or 'can we send today'.",
    parameters: { type: "object", properties: {} },
    run: async () => {
      const s = await cockpitGet<Record<string, unknown>>(
        "/api/emails/campaign/status",
      );
      return {
        pool_remaining: s.pool_remaining,
        cap_remaining: s.cap_remaining,
        funnel: s.funnel,
        validation: s.validation,
        campaign_state: s.status,
      };
    },
  },

  recall_knowledge: {
    description:
      "What has been learned about this account: which message performs best, where bounces come from, what is limiting volume. Call this FIRST for any question about strategy, performance or what to do differently.",
    parameters: {
      type: "object",
      properties: {
        topic: {
          type: "string",
          description: "Optional focus, e.g. 'angle', 'bounce', 'pipeline'",
        },
      },
    },
    run: async (args) => {
      const q = encodeURIComponent(String(args.topic ?? "").slice(0, 60));
      const r = await cockpitGet<{ items?: Record<string, unknown>[] }>(
        `/api/agent/knowledge?q=${q}&limit=12`,
      );
      return { learned: r.items ?? [] };
    },
  },

  remember_this: {
    description:
      "Store something the user tells you that should persist across conversations — a preference, a correction, a fact about the business. Use it when told something worth not forgetting.",
    parameters: {
      type: "object",
      properties: {
        subject: { type: "string", description: "Short key, e.g. 'preference:tone'" },
        fact: { type: "string", description: "The fact, one sentence" },
      },
      required: ["subject", "fact"],
    },
    run: async (args) => {
      await cockpitPost("/api/agent/remember", {
        kind: "told",
        subject: String(args.subject ?? "note").slice(0, 120),
        fact: String(args.fact ?? "").slice(0, 800),
        // A person stating something outranks anything the system inferred.
        confidence: 0.95,
        source: "user",
      });
      return { stored: true };
    },
  },

  find_more_leads: {
    description:
      "Start the lead finder now instead of waiting for the 03:00/15:00 schedule. Use when asked to find leads, refill the pool, or 'kick it off'. Idempotent — a run already in flight is reported, not duplicated.",
    parameters: { type: "object", properties: {} },
    run: async () => {
      const r = await cockpitPost<{ started?: boolean }>(
        "/api/pipeline/scrape",
        {},
      );
      return r.started
        ? {
            started: true,
            note: "Lead finder running. New leads appear on Leads within a few minutes.",
          }
        : { started: false, note: "A run was already in progress — left it alone." };
    },
  },

  find_contact_details: {
    description:
      "Start contact-finding, which turns leads with no address into named people with emails. This is what refills the sendable pool. Use when the pool is empty or nearly empty.",
    parameters: { type: "object", properties: {} },
    run: async () => {
      const r = await cockpitPost<Record<string, unknown>>(
        "/api/pipeline/enrich-contacts",
        {},
      );
      return { started: true, detail: r };
    },
  },

  check_inbox_now: {
    description:
      "Read the inbox and act on it immediately: defer follow-ups for out-of-office replies, stop them for real replies and opt-outs. Normally runs every 10 minutes.",
    parameters: { type: "object", properties: {} },
    run: async () =>
      await cockpitPost<Record<string, unknown>>("/api/agent/triage", {}),
  },

  refresh_what_we_know: {
    description:
      "Re-measure outcomes now and update what has been learned about which message performs best and where bounces come from. Normally runs hourly.",
    parameters: { type: "object", properties: {} },
    run: async () =>
      await cockpitPost<Record<string, unknown>>("/api/agent/learn", {}),
  },

  stop_emails_to_lead: {
    description:
      "Cancel the remaining follow-ups for one lead. Use when asked to stop emailing an organisation, or when a reply makes further chasing wrong. Already-sent emails are unaffected.",
    parameters: {
      type: "object",
      properties: {
        sequence_id: { type: "integer", description: "Sequence id for that lead" },
      },
      required: ["sequence_id"],
    },
    run: async (args) => {
      const id = Number(args.sequence_id);
      if (!Number.isFinite(id)) return { error: "sequence_id must be a number" };
      await cockpitPost(`/api/emails/sequences/${id}/stop`, {});
      return { stopped: true, sequence_id: id };
    },
  },

  /*
   * The one tool that reaches real people.
   *
   * Everything above changes state inside this system and is reversible from
   * the dashboard. This puts mail in front of real prospects on the instance's sending domain,
   * which is already carrying an 11.5% bounce rate — it cannot be undone and it
   * costs reputation, so consent is required in the conversation itself and is
   * never inferred from an earlier instruction.
   */
  send_approved_emails: {
    description:
      "Send the drafts waiting in the review queue. THIS PUTS EMAIL IN FRONT OF REAL SCHOOLS. Never call it unless the user has said yes to sending in this conversation — first say how many will go out and ask.",
    parameters: {
      type: "object",
      properties: {
        confirmed: {
          type: "boolean",
          description:
            "True only when the user has explicitly agreed to send, in this conversation",
        },
      },
      required: ["confirmed"],
    },
    run: async (args) => {
      if (args.confirmed !== true) {
        return {
          sent: false,
          error:
            "Not confirmed. Tell the user how many are queued and ask them to confirm before calling this again.",
        };
      }
      const r = await cockpitPost<{
        result?: { queued?: number };
        detail?: string;
      }>("/api/emails/send-approved", {});
      return { sent: true, queued: r.result?.queued ?? 0, detail: r.detail };
    },
  },

  search_leads: {
    description:
      "Find leads by name, city or state. Use when asked about a specific organisation.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "School or organisation name" },
      },
      required: ["query"],
    },
    run: async (args) => {
      const q = encodeURIComponent(String(args.query ?? "").slice(0, 80));
      const r = await cockpitGet<{ items?: Record<string, unknown>[] }>(
        `/api/accounts?mode=accounts&q=${q}`,
      );
      const items = (r.items ?? []).slice(0, 8).map((a) => ({
        company: a.company,
        location: a.location,
        icp_score: a.icp_score,
        contacts: a.contact_count,
        with_email: a.contact_email_count,
      }));
      return { found: r.items?.length ?? 0, showing: items };
    },
  },
};

function toolSchema() {
  return Object.entries(TOOLS).map(([name, t]) => ({
    type: "function",
    name,
    description: t.description,
    parameters: t.parameters,
  }));
}

/* ------------------------------------------------------------- deepseek -- */

/**
 * The assistant's instructions, with the instance's own identity substituted in.
 *
 * Built per call rather than frozen into a module constant, because it names
 * the business and the person who owns it. Hardcoded to the first client it was
 * written for, it told every OTHER client's assistant it worked for that
 * business — and the model happily said so, cited "schools" at a firm that
 * sells to manufacturers, and closed with somebody else's name.
 *
 * "prospect" and "organisation" replace the school vocabulary for the same
 * reason: the instance the words came from sells to school districts, and no
 * other one does.
 */
function systemPrompt(): string {
  const brand = getBrand();
  const owner = brand.signature.personName;

  return `You are the assistant inside the ${brand.name} CRM, used by ${owner} (who owns the business and closes deals by phone) and by the team running the outreach.

How to answer:
- Look things up before answering. Never guess a number — every figure you state must come from a tool call in this conversation.
- Be short. Two or three sentences, or a tight list. The reader is not technical and does not want a report.
- Lead with the action. "Call Anderson Industrial — they clicked twice and haven't replied" beats "engagement is trending positively".
- Name real organisations and people from the data. Specifics are the point.
- Never use internal jargon: no "milestone1", "ICP", "enrichment", "sequences", "data_batch". Say "lead", "email", "follow-up", "contact details".
- If something is broken or empty, say so plainly and say what would fix it. Do not reassure.
- You can DO things, not only report them. Asked to start the lead finder, find contacts, check the inbox, re-measure, or stop emailing a prospect — call the tool and do it. Never tell someone to go and press a button you can press yourself.
- One absolute exception: sending email to real prospects. Before send_approved_emails, say how many will go out and get an explicit yes in this conversation. Never infer consent from something said earlier.
- After acting, say in one line what you did and what will visibly change.

Formatting — this renders as markdown in a narrow side panel, roughly 40 characters wide:
- Open with one sentence that answers the question. No preamble.
- Then at most four bullets. Never nest them.
- Bold only the number or name that matters in a line, never a whole sentence.
- No headings, no tables, no horizontal rules. There is no room.
- Write 3,530 rather than 3530, and 14.4% rather than 0.144.

Context you may be given: the page the user is currently looking at. Use it to make your answer relevant to what is on their screen.`;
}

type Msg = { role: "user" | "assistant"; content: string };

/**
 * Pull the assistant text out of a Responses API payload.
 *
 * `output_text` is a convenience property of the OpenAI SDK, not a field
 * DeepSeek returns — reading it yields undefined and every answer comes back
 * empty. The text is nested:
 *
 *   output[] -> {type: "message"} -> content[] -> {type: "output_text"} -> text
 *
 * and the first output item is usually {type: "reasoning"}, which is the
 * model's scratchpad and must not be shown to the user.
 */
function outputText(
  output?: { type?: string; content?: { type?: string; text?: string }[] }[],
): string {
  return (output ?? [])
    .filter((o) => o.type === "message")
    .flatMap((o) => o.content ?? [])
    .filter((c) => c.type === "output_text")
    .map((c) => c.text ?? "")
    .join("")
    .trim();
}


/**
 * One turn, with a tool loop.
 *
 * DeepSeek's Responses API returns function calls as output items; each is
 * executed here and fed back, up to a small bound. The bound matters: a model
 * that loops on a failing tool would otherwise spend the account.
 */
async function respond(messages: Msg[], route?: string): Promise<{ text: string; used: string[] }> {
  const used: string[] = [];

  /*
   * Open the conversation already knowing.
   *
   * The learning loop measures outcomes hourly and writes conclusions to
   * agent_memory — which angle performs, where bounces concentrate, what is
   * capping volume. Loading the strongest of those into the system prompt is
   * the difference between an assistant that can look things up and one that
   * has an opinion: it can lead with "preseason_timing is your best message"
   * without being asked, and it will not contradict what it learned yesterday.
   *
   * Failure here is not fatal. No memory means a thinner answer, not an error,
   * so the whole thing stays behind a try.
   */
  let learned = "";
  try {
    const k = await cockpitGet<{ items?: { fact?: string; confidence?: number }[] }>(
      "/api/agent/knowledge?limit=10",
    );
    const lines = (k.items ?? [])
      .filter((f) => f.fact)
      .map((f) => {
        const c = Number(f.confidence ?? 0);
        const s = c >= 0.75 ? "high" : c >= 0.45 ? "medium" : "low";
        return `- (${s} confidence) ${f.fact}`;
      });
    if (lines.length) {
      learned =
        "\n\nWhat you have already learned about this account, from measuring " +
        "real outcomes. Use it. Say when confidence is low:\n" +
        lines.join("\n");
    }
  } catch {
    // Memory unavailable — answer from tools alone.
  }

  const input: Record<string, unknown>[] = messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));
  if (route) {
    input.unshift({
      role: "user",
      content: `[context] The user is currently on the "${route}" page.`,
    });
  }

  for (let turn = 0; turn < 4; turn++) {
    const res = await fetch(`${DEEPSEEK_BASE}/responses`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        instructions: systemPrompt() + learned,
        input,
        tools: toolSchema(),
        temperature: 0.2,
        max_output_tokens: 700,
      }),
      signal: AbortSignal.timeout(60_000),
    });

    if (!res.ok) {
      const detail = (await res.text()).slice(0, 300);
      throw new HTTPException(502, {
        message: `DeepSeek answered ${res.status}: ${detail}`,
      });
    }

    const body = (await res.json()) as {
      output?: {
        type?: string;
        name?: string;
        arguments?: string;
        call_id?: string;
        id?: string;
        content?: { type?: string; text?: string }[];
      }[];
    };

    const calls = (body.output ?? []).filter(
      (o) => o.type === "function_call" && o.name,
    );

    if (!calls.length) {
      return { text: outputText(body.output), used };
    }

    /*
     * Echo the WHOLE output array back, not just the function calls.
     *
     * DeepSeek's thinking mode emits a {type:"reasoning"} item alongside the
     * calls, and the next request is rejected outright without it:
     *
     *   400 "The `reasoning_text` in the thinking mode must be passed back
     *        to the API."
     *
     * Pushing only the function_call items — which is what the plain OpenAI
     * pattern does — made every tool-using question fail with a 502, i.e.
     * every question worth asking. The reasoning is the model's scratchpad:
     * it goes back on the wire, and outputText() keeps it off the screen.
     */
    for (const item of body.output ?? []) {
      input.push(item as unknown as Record<string, unknown>);
    }

    for (const call of calls) {
      const tool = TOOLS[call.name as string];
      let output: string;
      if (!tool) {
        output = JSON.stringify({ error: `unknown tool ${call.name}` });
      } else {
        used.push(call.name as string);
        try {
          const args = call.arguments ? JSON.parse(call.arguments) : {};
          output = JSON.stringify(await tool.run(args));
        } catch (e) {
          // Hand the failure back rather than throwing: the model can say "the
          // lead finder is not answering" far better than a 502 can.
          output = JSON.stringify({
            error: (e as Error)?.message ?? "tool failed",
          });
        }
      }
      input.push({
        type: "function_call_output",
        call_id: call.call_id ?? call.id,
        output,
      });
    }
  }

  return {
    text: "I could not finish looking that up. Try asking for one thing at a time.",
    used,
  };
}

/* --------------------------------------------------------------- router -- */

const assistant = new Hono<{ Variables: { userId: string } }>()
  .use("*", requireCrmAccess)

  /** Whether the assistant is switched on, so the UI can hide itself. */
  .get("/config", (c) =>
    c.json({
      enabled: Boolean(process.env.DEEPSEEK_API_KEY?.trim()),
      model: MODEL,
    }),
  )

  .post("/chat", async (c) => {
    const body = await c.req.json<{ messages?: Msg[]; route?: string }>();
    const messages = (body.messages ?? [])
      .filter((m) => m && typeof m.content === "string" && m.content.trim())
      // Bounded: the whole history is re-sent every turn and this is billed
      // per token.
      .slice(-12)
      .map((m) => ({
        role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
        content: m.content.slice(0, 4000),
      }));

    if (!messages.length) {
      throw new HTTPException(400, { message: "Nothing to answer" });
    }

    const { text, used } = await respond(messages, body.route);
    return c.json({ reply: text, tools_used: used });
  });

export default assistant;
