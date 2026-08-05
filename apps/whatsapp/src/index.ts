import "dotenv/config";

import { buildApp } from "./api";
import { config } from "./config";
import { postHeartbeat } from "./crm";
import { startOutboxPoller } from "./outbox";
import { getAccounts, initAccounts } from "./socket";

async function main(): Promise<void> {
  // Build every configured account and start each Baileys socket. A single
  // account's failure to start must not stop the others from coming up.
  const accounts = initAccounts();
  console.log(
    `[wa] starting ${accounts.length} account(s): ${accounts
      .map((a) => a.id)
      .join(", ")}`,
  );
  await Promise.all(
    accounts.map((a) =>
      a.start().catch((e) => console.error(`[wa:${a.id}] start failed:`, e)),
    ),
  );

  const app = buildApp();
  app.listen(config.port, () => {
    console.log(`[api] listening on :${config.port}`);
  });

  // Fire one heartbeat per account immediately so the CRM sees us as soon as
  // we're up, then settle into the regular cadence.
  const beat = (): void => {
    for (const a of getAccounts()) void postHeartbeat(a);
  };
  beat();
  setInterval(beat, config.heartbeatIntervalMs);

  // Drain any messages the CRM has queued (one poll loop per account).
  startOutboxPoller();
}

main().catch((e: unknown) => {
  console.error("[fatal]", e);
  process.exit(1);
});
