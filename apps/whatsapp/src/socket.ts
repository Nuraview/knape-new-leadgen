import { Boom } from "@hapi/boom";
import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
  type WASocket,
  type proto,
} from "@whiskeysockets/baileys";
import pino from "pino";
import QRCode from "qrcode";
import qrcodeTerminal from "qrcode-terminal";

import { config, type AccountConfig } from "./config";
import { onIncomingMessage, postHeartbeat } from "./crm";

export type WAState = {
  connected: boolean;
  jid: string | null;
  lastSeenAt: Date | null;
  qrDataUrl: string | null;
  qrIssuedAt: Date | null;
  lastError: string | null;
};

// One paired WhatsApp number. Each account owns an independent Baileys socket
// and auth dir, so the bridge can hold several linked numbers at once and the
// CRM can choose which one a message sends from.
export type Account = {
  id: string;
  label: string;
  authDir: string;
  state: WAState;
  start(): Promise<void>;
  sendText(to: string, body: string): Promise<{ id: string | null; to: string }>;
};

const registry = new Map<string, Account>();

export function getAccounts(): Account[] {
  return [...registry.values()];
}

export function getAccount(id: string): Account | undefined {
  return registry.get(id);
}

// Build (but don't yet start) one Account per configured slot. Idempotent.
export function initAccounts(): Account[] {
  for (const cfg of config.accounts) {
    if (!registry.has(cfg.id)) registry.set(cfg.id, createAccount(cfg));
  }
  return getAccounts();
}

function createAccount(cfg: AccountConfig): Account {
  const state: WAState = {
    connected: false,
    jid: null,
    lastSeenAt: null,
    qrDataUrl: null,
    qrIssuedAt: null,
    lastError: null,
  };

  let sock: WASocket | null = null;
  let reconnectTimer: NodeJS.Timeout | null = null;

  async function start(): Promise<void> {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }

    const { state: authState, saveCreds } = await useMultiFileAuthState(
      cfg.authDir,
    );
    const { version, isLatest } = await fetchLatestBaileysVersion();
    console.log(
      `[wa:${cfg.id}] using WA Web v${version.join(".")} (latest=${isLatest}) auth=${cfg.authDir}`,
    );

    sock = makeWASocket({
      version,
      auth: authState,
      logger: pino({ level: config.logLevel }) as never,
      browser: ["NuraviewCRM", "Chrome", "1.0"],
      syncFullHistory: false,
      markOnlineOnConnect: false,
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        // First QR of this connection attempt? Baileys rotates the QR every
        // ~20s for as long as an account stays unpaired — pushing a heartbeat
        // on EVERY rotation means an unpaired account hammers the CRM forever
        // (one POST/~20s), which trips the host's automatic rate mitigation and
        // takes down heartbeats for the OTHER accounts too. So we push only the
        // first QR (for fast UI display); the regular 30s heartbeat carries
        // every subsequent rotation.
        const isFirstQr = !state.qrDataUrl;
        qrcodeTerminal.generate(qr, { small: true });
        state.qrDataUrl = await QRCode.toDataURL(qr, { margin: 1, width: 320 });
        state.qrIssuedAt = new Date();
        console.log(
          `[wa:${cfg.id}] QR refreshed — open WhatsApp -> Linked Devices -> Link a Device, then scan`,
        );
        if (isFirstQr) void postHeartbeat(account);
      }

      if (connection === "open") {
        state.connected = true;
        state.jid = sock?.user?.id ?? null;
        state.lastSeenAt = new Date();
        state.qrDataUrl = null;
        state.qrIssuedAt = null;
        state.lastError = null;
        console.log(`[wa:${cfg.id}] connected as ${state.jid}`);
        // Tell the CRM we're connected immediately.
        void postHeartbeat(account);
      }

      if (connection === "close") {
        state.connected = false;
        const code = (lastDisconnect?.error as Boom | undefined)?.output
          ?.statusCode;
        const isLoggedOut = code === DisconnectReason.loggedOut;
        state.lastError =
          lastDisconnect?.error?.message ?? `disconnected (code ${code})`;
        console.log(
          `[wa:${cfg.id}] connection closed: ${state.lastError} (code=${code})`,
        );
        // Surface the disconnect to the CRM so the admin panel flips the
        // account's badge red without waiting for the next 30s heartbeat.
        void postHeartbeat(account);

        if (isLoggedOut) {
          console.log(
            `[wa:${cfg.id}] logged out by WhatsApp — wipe ${cfg.authDir} and restart to re-pair`,
          );
          return;
        }
        reconnectTimer = setTimeout(() => {
          start().catch((e) =>
            console.error(`[wa:${cfg.id}] reconnect failed:`, e),
          );
        }, 3_000);
      }
    });

    sock.ev.on("messages.upsert", async ({ messages, type }) => {
      if (type !== "notify") return;
      for (const msg of messages) {
        if (msg.key.fromMe) continue;
        state.lastSeenAt = new Date();
        try {
          await onIncomingMessage(account, msg);
        } catch (e) {
          console.error(
            `[wa:${cfg.id}] inbound webhook failed:`,
            (e as Error).message,
          );
        }
      }
    });
  }

  async function sendText(
    to: string,
    body: string,
  ): Promise<{ id: string | null; to: string }> {
    if (!sock || !state.connected) {
      throw new Error(`account ${cfg.id} not connected to WhatsApp`);
    }
    const jid = formatJid(to);
    const result = await sock.sendMessage(jid, { text: body });
    return { id: result?.key?.id ?? null, to: jid };
  }

  const account: Account = {
    id: cfg.id,
    label: cfg.label,
    authDir: cfg.authDir,
    state,
    start,
    sendText,
  };
  return account;
}

function formatJid(input: string): string {
  if (input.includes("@")) return input;
  const digits = input.replace(/\D/g, "");
  if (!digits) throw new Error(`invalid recipient: ${input}`);
  return `${digits}@s.whatsapp.net`;
}

export type { proto };
