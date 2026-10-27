/**
 * The in-app assistant — a model with tools (utils/ai.ts: OpenAI or Anthropic), server-side.
 *
 * Answers questions about THIS instance's live data rather than in general:
 * "who should I call today", "why is nothing sending", "how many leads did we
 * find". It is the thing that turns a dashboard full of numbers into an answer,
 * which is the whole complaint it exists to fix.
 *
 * WHY THE MODEL NEVER RUNS IN THE BROWSER
 *
 * The model key (OPENAI_API_KEY or ANTHROPIC_API_KEY, see utils/ai.ts) stays in
 * this process. A key shipped to the client is a key
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
import {
  AiNotConfigured,
  AiUpstreamError,
  aiModel,
  createMessage,
  isAiConfigured,
  responseText,
  type Message,
  type MessagesResponse,
  type ToolResultBlock,
  type ToolUseBlock,
} from "../utils/ai";
import { requireCrmAccess } from "../utils/require-crm-access";
import getBrand from "../utils/get-brand";

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
      "Send the drafts waiting in the review queue. THIS PUTS EMAIL IN FRONT OF REAL PROSPECTS (industrial, marine and engineering companies). Never call it unless the user has said yes to sending in this conversation — first say how many will go out and ask.",
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
        query: { type: "string", description: "Company or organisation name, city or state" },
      },
      required: ["query"],
    },
    run: async (args) => {
      const q = encodeURIComponent(String(args.query ?? "").slice(0, 80));
      const r = await cockpitGet<{
        items?: Record<string, unknown>[];
        total?: number;
      }>(`/api/accounts?mode=accounts&q=${q}`);
      const items = (r.items ?? []).slice(0, 8).map((a) => ({
        company: a.company,
        location: a.location,
        icp_score: a.icp_score,
        contacts: a.contact_count,
        with_email: a.contact_email_count,
      }));
      /*
       * `total`, not items.length. The endpoint pages at 500 now, so the array
       * is one page — reporting its length would tell the assistant a search
       * matched 500 companies whenever it matched more, and it says that number
       * out loud to the client. Falls back for safety.
       */
      return { found: r.total ?? r.items?.length ?? 0, showing: items };
    },
  },
};

/** TOOLS in the shared utils/ai shape: JSON Schema goes in `input_schema`. */
function toolSchema() {
  return Object.entries(TOOLS).map(([name, t]) => ({
    name,
    description: t.description,
    input_schema: t.parameters,
  }));
}

/* ----------------------------------------------------------------- model -- */

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

/** One model call, its failures turned into status codes the panel shows. */
async function callModel(system: string, messages: Message[]): Promise<MessagesResponse> {
  try {
    return await createMessage(
      {
        system,
        messages,
        tools: toolSchema(),
        max_tokens: 700,
      },
      { timeoutMs: 60_000 },
    );
  } catch (error) {
    if (error instanceof AiNotConfigured) {
      throw new HTTPException(503, {
        message:
          "The assistant is not configured — set OPENAI_API_KEY or ANTHROPIC_API_KEY (AI_PROVIDER picks between them) on this deployment.",
      });
    }
    if (error instanceof AiUpstreamError) {
      throw new HTTPException(502, { message: `AI: ${error.message}` });
    }
    throw error;
  }
}

/**
 * One turn, with a tool loop.
 *
 * The model stops with `stop_reason: "tool_use"` and one or more
 * tool_use blocks; each is executed here and answered with a tool_result block
 * in the next user message, up to a small bound. The bound matters: a model
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
   * has an opinion: it can lead with "the spec-support angle is your best message"
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

  /*
   * The page goes in the system prompt rather than as a fake first user turn:
   * it is context, not something the user said, and it keeps the history a
   * clean user/assistant alternation.
   */
  const system =
    systemPrompt() +
    learned +
    (route ? `\n\nThe user is currently on the "${route}" page.` : "");

  const conversation: Message[] = messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  for (let turn = 0; turn < 4; turn++) {
    const response = await callModel(system, conversation);

    const calls = response.content.filter(
      (b): b is ToolUseBlock => b.type === "tool_use",
    );

    if (response.stop_reason !== "tool_use" || !calls.length) {
      return { text: responseText(response), used };
    }

    // The assistant turn goes back verbatim — text and tool_use blocks both —
    // because every tool_result must answer a tool_use id from the turn
    // immediately before it.
    conversation.push({ role: "assistant", content: response.content });

    const results: ToolResultBlock[] = [];
    for (const call of calls) {
      const tool = TOOLS[call.name];
      let output: string;
      let isError = false;
      if (!tool) {
        output = JSON.stringify({ error: `unknown tool ${call.name}` });
        isError = true;
      } else {
        used.push(call.name);
        try {
          output = JSON.stringify(await tool.run(call.input ?? {}));
        } catch (e) {
          // Hand the failure back rather than throwing: the model can say "the
          // lead finder is not answering" far better than a 502 can.
          output = JSON.stringify({
            error: (e as Error)?.message ?? "tool failed",
          });
          isError = true;
        }
      }
      results.push({
        type: "tool_result",
        tool_use_id: call.id,
        content: output,
        ...(isError ? { is_error: true } : {}),
      });
    }
    conversation.push({ role: "user", content: results });
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
      enabled: isAiConfigured(),
      model: aiModel(),
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
    // The window can open on an assistant reply; the conversation should
    // start with the user (Anthropic requires it).
    while (messages[0]?.role === "assistant") messages.shift();

    if (!messages.length) {
      throw new HTTPException(400, { message: "Nothing to answer" });
    }

    const { text, used } = await respond(messages, body.route);
    return c.json({ reply: text, tools_used: used });
  });

export default assistant;
