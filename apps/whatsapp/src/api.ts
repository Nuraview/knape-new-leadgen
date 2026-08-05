import express, { type NextFunction, type Request, type Response } from "express";

import { config } from "./config";
import { getAccount, getAccounts } from "./socket";
import { checkSendAllowed, recordSend, throttleStatus } from "./throttle";

const DEFAULT_ACCOUNT = "primary";

export function buildApp(): express.Express {
  const app = express();
  app.use(express.json({ limit: "256kb" }));

  // Public — used by container healthchecks and reverse proxies.
  app.get("/health", (_req: Request, res: Response) => {
    res.json({ ok: true });
  });

  // All routes below require the shared bearer secret.
  app.use((req: Request, res: Response, next: NextFunction) => {
    const got = req.headers.authorization;
    if (got !== `Bearer ${config.apiKey}`) {
      return res.status(401).json({ error: "unauthorized" });
    }
    next();
  });

  app.get("/status", (_req: Request, res: Response) => {
    res.json({
      accounts: getAccounts().map((a) => ({
        account: a.id,
        label: a.label,
        connected: a.state.connected,
        jid: a.state.jid,
        last_seen_at: a.state.lastSeenAt?.toISOString() ?? null,
        qr_pending: a.state.qrDataUrl !== null,
        qr_issued_at: a.state.qrIssuedAt?.toISOString() ?? null,
        last_error: a.state.lastError,
        throttle: throttleStatus(a.id),
      })),
    });
  });

  // Returns the current QR as PNG when unpaired, 204 No Content when paired.
  // Pick the account with ?account=<id> (defaults to primary).
  app.get("/qr", (req: Request, res: Response) => {
    const id = (req.query.account as string) || DEFAULT_ACCOUNT;
    const account = getAccount(id);
    if (!account) {
      return res.status(404).json({ error: `unknown account: ${id}` });
    }
    if (!account.state.qrDataUrl) {
      return res.status(204).end();
    }
    const png = Buffer.from(
      account.state.qrDataUrl.replace(/^data:image\/png;base64,/, ""),
      "base64",
    );
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "no-store");
    return res.send(png);
  });

  app.post("/send", async (req: Request, res: Response) => {
    const { account: accountId, to, body } = (req.body ?? {}) as {
      account?: string;
      to?: string;
      body?: string;
    };
    if (!to || !body) {
      return res.status(400).json({ error: "to and body required" });
    }
    const account = getAccount(accountId || DEFAULT_ACCOUNT);
    if (!account) {
      return res
        .status(404)
        .json({ error: `unknown account: ${accountId ?? DEFAULT_ACCOUNT}` });
    }

    const gate = checkSendAllowed(account.id);
    if (!gate.ok) {
      return res
        .status(429)
        .json({ error: gate.reason, retry_after_ms: gate.retryAfterMs });
    }

    try {
      const result = await account.sendText(to, body);
      recordSend(account.id);
      return res.json(result);
    } catch (e) {
      return res.status(500).json({ error: (e as Error).message });
    }
  });

  return app;
}
