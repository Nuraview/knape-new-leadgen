/**
 * Terms for a one-off project, as opposed to a retainer.
 *
 * The house proposal this feature inherits from (Peter's, #1021) is a MONTHLY
 * RETAINER. Its Service Terms talk about "one active project or campaign thread
 * at a time" and its refund policy is a pro-rata calculation over unused days
 * of a monthly engagement. Copied onto a $350 fixed-price project — which is
 * most of what goes out — those clauses are not merely irrelevant, they promise
 * something nobody offers and, in VK's words on the 31 July call, read as a red
 * flag on a small job.
 *
 * So a PROJECT proposal gets these instead. They are code rather than a second
 * database template because there is no project template on record yet and one
 * is needed today; the moment somebody marks a real project proposal as a
 * template, house-template.ts prefers that and this becomes the fallback.
 */

/**
 * The clause the Ashima project cost us.
 *
 * "Unlimited revisions" was taken at face value on a website that ran from
 * February to July with no additional payment. The wording below has to do two
 * things at once: keep the promise that actually wins work, and put a boundary
 * on it that can be pointed at later without sounding like a trap. Hence the
 * last sentence — nothing is ever invoiced without being agreed first, which is
 * what stops the boundary reading as a hidden fee.
 */
export const FAIR_USE_HTML = `<h3>Fair use</h3><p>Unlimited revisions means what it says. We will keep refining the work until it is right, at no extra cost, whether a change is down to a mistake of ours or a change of mind on yours.</p><p>What it is not is an open-ended commitment. Revisions are included for the duration of the project and for two weeks after final delivery. If requests are still arriving well beyond that, or the direction changes substantially after sign-off, we will say so before doing the work and agree a figure with you first. Nothing is ever invoiced that you have not approved in advance.</p>`;

/** Payment, delivery and ownership for fixed-price work. */
const PROJECT_SERVICE_TERMS = `<h3>What is included</h3><ul><li>Everything listed in the scope above, delivered in the agreed formats</li><li>Revisions as described under Fair use</li><li>A named point of contact for the duration of the project</li><li>Full ownership of the final files on receipt of final payment</li></ul><h3>How it works</h3><ul><li>Work begins once the upfront payment clears and we have the assets and access we need from you</li><li>Deliverables are shared for review at the points set out in the timeline</li><li>Feedback consolidated into one round keeps the project moving fastest</li><li>The balance falls due on final delivery, before the source files are handed over</li></ul><h3>What is not included</h3><ul><li>Work outside the scope above. We are happy to quote for it separately</li><li>Third-party costs — stock, fonts, licences, paid tools — which are passed on at cost and only ever with your approval first</li></ul>`;

/**
 * Cancellation and refunds for fixed-price work, collapsed behind a click.
 *
 * The retainer template prints a pro-rata calculation over unused days of a
 * month, which does not describe a project at all. This does — and it sits
 * inside a <details> so the proposal reads as one page of scope and price with
 * a line you can open, rather than a wall of policy. VK on the call: "this is a
 * red flag, including all that... let them click on it and let them view."
 *
 * Collapsed, not removed and not moved to another page: everything a client
 * agrees to stays on the document they sign.
 */
const PROJECT_CANCELLATION = `<details><summary>Cancellation and refunds</summary><p>If you cancel before work begins, the upfront payment is returned in full.</p><p>If you cancel partway through, we invoice only for the work completed up to that point and return the rest. Anything already delivered is yours to keep and to use.</p><p>If we cannot deliver what was agreed here, you are refunded in full.</p></details>`;

export type BoilerplateSection = Record<string, unknown>;

/**
 * The terms a project proposal carries — all of them, on this page.
 *
 * What is included, how it works, what is not, and fair use stay in plain
 * sight: they are commercial terms a buyer should see before signing. Only the
 * cancellation detail is collapsed, because that is the part nobody reads on a
 * small job and printing it in full is what made the last one look heavy.
 */
export function buildProjectTerms(): BoilerplateSection[] {
  return [
    {
      key: "service-terms",
      type: "richtext",
      title: "Service Terms",
      bodyHtml: `${PROJECT_SERVICE_TERMS}${FAIR_USE_HTML}${PROJECT_CANCELLATION}`,
      order: 0,
    },
  ];
}

/**
 * Is this section written for a monthly retainer rather than a project?
 *
 * Decided from the text, not a hardcoded list of titles, so it keeps working
 * when the house proposal is edited or replaced. A pro-rata refund over unused
 * days, or a clause that calls itself a retainer, belongs to a retainer.
 * Testimonials are never engagement-specific — they are quotes about the
 * agency, and they go on everything.
 */
export function isRetainerOnly(section: BoilerplateSection): boolean {
  if (String(section.type ?? "") === "testimonials") return false;

  const haystack = [
    String(section.title ?? ""),
    String(section.bodyHtml ?? ""),
  ]
    .join(" ")
    .toLowerCase();

  return (
    /\bretainer\b/.test(haystack) ||
    /pro-?rata/.test(haystack) ||
    /\bcancellation\b/.test(haystack) ||
    /unused days/.test(haystack) ||
    /\bper month\b|\bmonthly\b/.test(haystack)
  );
}
