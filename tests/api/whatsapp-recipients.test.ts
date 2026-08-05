/**
 * Who a WhatsApp notification is actually addressed to.
 *
 * Two environment variables decide this and they are easy to confuse:
 * WHATSAPP_RECIPIENTS is the LEGACY REMINDER list, whose first entry happens to
 * be the owner, and WHATSAPP_EMPLOYEE_NUMBERS is the per-person map. Treating
 * the first as "the owners" is exactly the bug that sent every comment in the
 * workspace to an employee who only appears in it so the lead reminder cron can
 * route by name.
 *
 * The owner also appears in the employee map — he has cards and due dates like
 * anyone else — so the guard that stops him being told twice about the same
 * comment is the other thing pinned down here.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  duplicatesOwnerBroadcast,
  ownerJid,
} from "../../apps/api/src/notification/whatsapp";

const OWNER_NUMBER = "+919591194679";
const OWNER_EMAIL = "varshith@nuraview.com";

/** Production shape: owner first, then an employee who reviews leads. */
const RECIPIENTS = `VK:${OWNER_NUMBER},AbdulMateen:+919353087583`;
const EMPLOYEES = [
  "mateen@nuraview.com:+919353087583",
  "javed@nuraview.com:+917019000677",
  `${OWNER_EMAIL}:${OWNER_NUMBER}`,
].join(",");

const ORIGINAL = { ...process.env };

beforeEach(() => {
  process.env.WHATSAPP_RECIPIENTS = RECIPIENTS;
  process.env.WHATSAPP_EMPLOYEE_NUMBERS = EMPLOYEES;
});

afterEach(() => {
  process.env = { ...ORIGINAL };
});

describe("ownerJid", () => {
  it("takes the first recipient and nobody else", () => {
    expect(ownerJid()).toBe("919591194679@s.whatsapp.net");
  });

  it("is null when nothing is configured, rather than a malformed jid", () => {
    process.env.WHATSAPP_RECIPIENTS = "";
    expect(ownerJid()).toBeNull();
  });

  it("tolerates an entry with no name prefix", () => {
    process.env.WHATSAPP_RECIPIENTS = OWNER_NUMBER;
    expect(ownerJid()).toBe("919591194679@s.whatsapp.net");
  });
});

describe("duplicatesOwnerBroadcast", () => {
  it.each(["task_status_changed", "task_comment", "task_mention"])(
    "suppresses %s for the owner, who already gets it board-wide",
    (type) => {
      expect(duplicatesOwnerBroadcast(OWNER_EMAIL, type)).toBe(true);
    },
  );

  it.each([
    "task_created",
    "task_assignee_changed",
    "due_date_reminder",
    "task_overdue",
  ])("lets %s through — the owner gets no board-wide equivalent", (type) => {
    expect(duplicatesOwnerBroadcast(OWNER_EMAIL, type)).toBe(false);
  });

  it("matches the owner regardless of email casing", () => {
    expect(
      duplicatesOwnerBroadcast("Varshith@NuraView.com", "task_comment"),
    ).toBe(true);
  });

  it("matches the owner by NUMBER, not by which email is configured", () => {
    process.env.WHATSAPP_EMPLOYEE_NUMBERS = `vk@nuraview.com:${OWNER_NUMBER}`;
    expect(duplicatesOwnerBroadcast("vk@nuraview.com", "task_comment")).toBe(
      true,
    );
  });

  it("suppresses nothing for an employee further down the recipient list", () => {
    // Mateen is in WHATSAPP_RECIPIENTS too, but only the first entry is the
    // owner — his personal mirror must still reach him.
    expect(
      duplicatesOwnerBroadcast("mateen@nuraview.com", "task_comment"),
    ).toBe(false);
  });

  it("suppresses nothing for an ordinary employee", () => {
    expect(duplicatesOwnerBroadcast("javed@nuraview.com", "task_comment")).toBe(
      false,
    );
  });

  it("suppresses nothing for someone with no number configured", () => {
    expect(duplicatesOwnerBroadcast("habib@nuraview.com", "task_comment")).toBe(
      false,
    );
  });

  it("handles the spacing people actually paste numbers with", () => {
    process.env.WHATSAPP_EMPLOYEE_NUMBERS = ` ${OWNER_EMAIL} : +91 95911 94679 `;
    expect(duplicatesOwnerBroadcast(OWNER_EMAIL, "task_mention")).toBe(true);
  });

  it("ignores an unknown type and a missing email", () => {
    expect(duplicatesOwnerBroadcast(OWNER_EMAIL, "workspace_created")).toBe(
      false,
    );
    expect(duplicatesOwnerBroadcast(OWNER_EMAIL, undefined)).toBe(false);
    expect(duplicatesOwnerBroadcast(null, "task_comment")).toBe(false);
  });
});
