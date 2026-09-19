import { describe, expect, it } from "vitest";
import {
  extractEmailsFromText,
  extractEmailFromText,
  isUsableContactEmail,
} from "../../apps/api/src/utils/extract-email";

/**
 * The posting-body email reader.
 *
 * This is the free half of the email column: the scraper never sends an address
 * (Upwork hides the client's), so whatever we lift out of the description is
 * written straight into crm_Leads.email and is what a reviewer will send to. The
 * cost of a false positive is therefore a real email to the wrong person, and
 * the tests below are mostly about what must NOT come through.
 */
describe("extract-email", () => {
  describe("picks the address a poster actually wrote", () => {
    it("reads a plain address out of prose", () => {
      const body =
        "We need a 12-slide pitch deck for our seed round. Send samples to hello@northwind.io and we'll reply within two days.";
      expect(extractEmailFromText(body)).toBe("hello@northwind.io");
    });

    it("survives the wrapping punctuation scraped HTML leaves behind", () => {
      const body = "Contact <jane.doe@acme.co.uk>, or see our site.";
      expect(extractEmailFromText(body)).toBe("jane.doe@acme.co.uk");
    });

    it("prefers the client's own name over a shared inbox", () => {
      // info@ comes first, which is exactly why the scoring has to beat order.
      const body = "Questions: info@acme.com. I'm the hiring manager — mark@acme.com works too.";
      expect(
        extractEmailFromText(body, { firstName: "Mark", lastName: "Reyes" }),
      ).toBe("mark@acme.com");
    });

    it("prefers a shared inbox over an unrelated address in the body", () => {
      const body =
        "Audio notes go to stems@studio.fm — reach the team at sales@brightside.com.";
      expect(extractEmailFromText(body)).toBe("sales@brightside.com");
    });

    it("falls back to the first usable address when nothing scores", () => {
      const body = "Ping me: a@one.com, b@two.com";
      expect(extractEmailFromText(body)).toBe("a@one.com");
    });
  });

  describe("refuses what must never reach a lead", () => {
    it("drops bounce and role-only plumbing", () => {
      expect(isUsableContactEmail("noreply@acme.com")).toBe(false);
      expect(isUsableContactEmail("no-reply@acme.com")).toBe(false);
      expect(isUsableContactEmail("postmaster@acme.com")).toBe(false);
      expect(isUsableContactEmail("mailer-daemon@acme.com")).toBe(false);
    });

    it("drops placeholder and sample addresses", () => {
      expect(isUsableContactEmail("email1@example.com")).toBe(false);
      expect(isUsableContactEmail("name@yourdomain.com")).toBe(false);
      expect(isUsableContactEmail("test@test.com")).toBe(false);
      expect(isUsableContactEmail("john@company.com")).toBe(false);
    });

    it("drops asset filenames that look like addresses", () => {
      // Real pattern in scraped markup: srcset / retina asset names.
      expect(isUsableContactEmail("logo@2x.png")).toBe(false);
      expect(isUsableContactEmail("sprite@3x.webp")).toBe(false);
      expect(extractEmailsFromText('src="hero@2x.jpg" alt="mail: real@acme.com"')).toEqual([
        "real@acme.com",
      ]);
    });

    it("drops the platform's own mailboxes", () => {
      expect(isUsableContactEmail("support@upwork.com")).toBe(false);
      expect(isUsableContactEmail("noreply@upworkmail.com")).toBe(false);
    });

    it("drops malformed input rather than guessing", () => {
      expect(isUsableContactEmail("not-an-email")).toBe(false);
      expect(isUsableContactEmail("a@b")).toBe(false);
      expect(isUsableContactEmail("@acme.com")).toBe(false);
      expect(isUsableContactEmail("john@acme..com")).toBe(false);
      expect(isUsableContactEmail(null)).toBe(false);
      expect(extractEmailFromText("")).toBeNull();
      expect(extractEmailFromText(undefined)).toBeNull();
      expect(extractEmailFromText("no addresses here at all")).toBeNull();
    });
  });

  describe("de-duplicates and bounds the scan", () => {
    it("collapses case-insensitive repeats, keeping the first", () => {
      expect(extractEmailsFromText("Hi@Acme.com then hi@acme.com")).toEqual([
        "hi@acme.com",
      ]);
    });

    it("treats a wall of addresses as a list, not a contact", () => {
      const many = Array.from({ length: 30 }, (_, i) => `person${i}@list.com`).join(" ");
      expect(extractEmailsFromText(many)).toHaveLength(8);
    });
  });

  describe("handles obfuscated email addresses", () => {
    it("extracts [at] + [dot] pattern", () => {
      expect(extractEmailFromText("Contact: john[at]acme[dot]com")).toBe("john@acme.com");
    });

    it("extracts (at) + (dot) pattern", () => {
      expect(extractEmailFromText("Contact: john(at)acme(dot)com")).toBe("john@acme.com");
    });

    it("extracts {at} + {dot} pattern", () => {
      expect(extractEmailFromText("Contact: john{at}acme{dot}com")).toBe("john@acme.com");
    });

    it("extracts word at + dot pattern", () => {
      expect(extractEmailFromText("Contact: john at acme dot com")).toBe("john@acme.com");
    });

    it("extracts multi-label TLD domains", () => {
      expect(extractEmailFromText("Contact: john at acme dot co dot uk")).toBe("john@acme.co.uk");
      expect(extractEmailFromText("Contact: john at acme dot com dot au")).toBe("john@acme.com.au");
      expect(extractEmailFromText("Contact: john at acme dot org dot uk")).toBe("john@acme.org.uk");
    });

    it("extracts hybrid literal @ + word dot pattern", () => {
      expect(extractEmailFromText("Contact: john@acme dot com")).toBe("john@acme.com");
      expect(extractEmailFromText("Contact: john @ acme dot com")).toBe("john@acme.com");
      expect(extractEmailFromText("Contact: john@acme dot co dot uk")).toBe("john@acme.co.uk");
    });

    it("extracts supported reconstructed country TLDs and handles literal country TLDs", () => {
      // Obfuscated
      expect(extractEmailFromText("john at acme dot in")).toBe("john@acme.in");
      expect(extractEmailFromText("john at acme dot me")).toBe("john@acme.me");
      expect(extractEmailFromText("john at acme dot us")).toBe("john@acme.us");
      expect(extractEmailFromText("john at acme dot is")).toBeNull();
      expect(extractEmailFromText("john at acme dot at")).toBeNull();

      // Literal @
      expect(extractEmailFromText("john@acme.in")).toBe("john@acme.in");
      expect(extractEmailFromText("john@acme.me")).toBe("john@acme.me");
      expect(extractEmailFromText("john@acme.is")).toBe("john@acme.is");
      expect(extractEmailFromText("john@acme.at")).toBe("john@acme.at");
      expect(extractEmailFromText("john@acme.us")).toBe("john@acme.us");
    });

    it("extracts whitespace and newline obfuscation variants", () => {
      expect(extractEmailFromText("Reach us at john  [at] \n  acme  [dot] \n  com")).toBe("john@acme.com");
      expect(extractEmailFromText("Email: john at acme\n dot com")).toBe("john@acme.com");
    });

    it("preserves existing mailto cases", () => {
      expect(extractEmailFromText("mailto:john@acme.com")).toBe("john@acme.com");
      expect(extractEmailFromText("[Contact](mailto:john@acme.com)")).toBe("john@acme.com");
      expect(extractEmailFromText("<mailto:john@acme.com>")).toBe("john@acme.com");
    });

    it("preserves HTML entity and %40 cases", () => {
      expect(extractEmailFromText("john&#64;acme&#46;com")).toBe("john@acme.com");
      expect(extractEmailFromText("john%40acme.com")).toBe("john@acme.com");
    });

    it("refuses English prose false positives", () => {
      expect(extractEmailFromText("contact us at acme dot com")).toBeNull();
      expect(extractEmailFromText("we work at acme dot com")).toBeNull();
      expect(extractEmailFromText("meet us at acme dot com")).toBeNull();
      expect(extractEmailFromText("located at acme dot com")).toBeNull();
      expect(extractEmailFromText("based at acme dot com")).toBeNull();
      expect(extractEmailFromText("stay at hotel in delhi")).toBeNull();
      expect(extractEmailFromText("meet at 3 dot 5 pm")).toBeNull();
      expect(extractEmailFromText("dinner at acme dot com")).toBeNull();
      expect(extractEmailFromText("meeting at acme dot com")).toBeNull();
      expect(extractEmailFromText("office at acme dot com")).toBeNull();
    });

    it("extracts bare-word emails in contact context and standalone lines", () => {
      expect(extractEmailFromText("contact john at acme dot com")).toBe("john@acme.com");
      expect(extractEmailFromText("email john at acme dot com")).toBe("john@acme.com");
      expect(extractEmailFromText("john at acme dot com")).toBe("john@acme.com");
      expect(extractEmailFromText("john smith at acme dot com")).toBe("smith@acme.com");
      expect(extractEmailFromText("please send resume to john at acme dot com")).toBe("john@acme.com");
      expect(extractEmailFromText("reach me at john at acme dot com")).toBe("john@acme.com");
    });
  });
});


