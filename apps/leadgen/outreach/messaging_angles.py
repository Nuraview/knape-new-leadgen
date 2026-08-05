"""The 10 messaging angles (opener + 3 follow-ups each).

Each angle carries its own 4-step sequence with a value-add link in every email.
Bodies use the tokens ``{fn}`` (first name), ``{company}``, ``{sig}``
(signal/evidence, blank-safe), ``{role}`` (job title), ``{signer}`` (sender name)
and ``{SITE}`` — rendered by ``render_angle_steps``.

Used by ``personalize._template_sequence`` (deterministic / template fallback) and
``email_drafting.draft_email_sequence`` (AI path injects the angle hook + link).

WHY THE LINKS COME FROM ENV
---------------------------
This module used to hardcode one client's domain and three of their landing
pages. That is the single most dangerous kind of hardcoding in the outbound
path: a link is the one thing in a cold email a recipient actually acts on, and
a wrong one either 404s or, worse, sends this client's prospects to a different
company's website.

It is also how the original went wrong in the first place — eight paths were
written into the copy that had never existed, and 1,204 of the 1,227 emails
already sent carried one, so everyone who clicked landed on a Page Not Found.
Nothing in the code had checked, because the URLs were literals.

So the domain is BRAND_MARKETING_URL and the approved pages are
OUTREACH_APPROVED_LINKS (comma-separated, optional). With nothing configured
beyond the domain, every CTA points at the site root — which is dull, and is
guaranteed to resolve. ``enforce_approved_links`` still rewrites anything else
on that domain back to an approved page, so a URL invented by the AI downstream
cannot reach a recipient.
"""

from __future__ import annotations

import os
import re
from typing import Any

from outreach import brand


def _site() -> str:
    return brand.site_url().rstrip("/")


#: The only domain outreach may link to.
SITE = _site()

#: The approved landing pages, in preference order.
#:
#: OUTREACH_APPROVED_LINKS is a comma-separated list of absolute URLs. Unset,
#: the list is just the site root: a real page on the right domain, which is the
#: only claim that can be made without knowing this instance's site map.
def _approved() -> tuple[str, ...]:
    raw = (os.getenv("OUTREACH_APPROVED_LINKS") or "").strip()
    links = tuple(u.strip().rstrip("/") for u in raw.split(",") if u.strip()) if raw else ()
    return links or (SITE,)


APPROVED_LINKS: tuple[str, ...] = _approved()

#: The default CTA target. Everything unrecognised collapses to this.
LINK_PROGRAM = APPROVED_LINKS[0]
#: Named aliases kept so callers that import them keep working; they degrade to
#: the primary link when the instance has not declared separate pages.
LINK_GUIDE = APPROVED_LINKS[1] if len(APPROVED_LINKS) > 1 else LINK_PROGRAM
LINK_COST = APPROVED_LINKS[2] if len(APPROVED_LINKS) > 2 else LINK_PROGRAM

#: An optional social post to link from one follow-up.
#:
#: A cold recipient will not click an unfamiliar domain, but they will open
#: linkedin.com — a name they already trust and a face they can check. Empty
#: unless the instance sets it, and the sequences fall back to the site link.
LINK_LINKEDIN_POST = (os.getenv("OUTREACH_LINKEDIN_POST_URL") or "").strip() or LINK_PROGRAM


def _all_approved() -> tuple[str, ...]:
    seen: list[str] = []
    for u in (*APPROVED_LINKS, LINK_LINKEDIN_POST):
        if u and u not in seen:
            seen.append(u)
    return tuple(seen)


#: Any URL on our own domain that is not an approved page. Rewritten, not
#: dropped: the copy reads as though a link belongs there, so removing it leaves
#: a dangling sentence.
_OWN_DOMAIN_URL = re.compile(
    r"https?://[^\s<>\"')]*" + re.escape(re.sub(r"^https?://", "", SITE).rstrip("/")) + r"[^\s<>\"')]*",
    re.I,
)


def enforce_approved_links(text: str) -> str:
    """Rewrite any non-approved URL on our domain to the primary approved page.

    Applied to every body, template-written or AI-written, so a wrong link
    cannot reach a recipient even when it is invented downstream.
    """
    if not text:
        return text
    approved = _all_approved()

    def _sub(m: re.Match[str]) -> str:
        url = m.group(0)
        trail = ""
        while url and url[-1] in ".,;:)]}":
            trail = url[-1] + trail
            url = url[:-1]
        if url.rstrip("/") in approved:
            return url + trail
        return LINK_PROGRAM + trail

    return _OWN_DOMAIN_URL.sub(_sub, text)


def has_value_link(text: str) -> bool:
    return any(u in (text or "") for u in _all_approved())


def ensure_value_link(text: str, angle_key: str = "") -> str:
    """Guarantee every outbound body carries exactly one usable link.

    An email with no call to action is a wasted send, and the AI path drops the
    link often enough that this cannot be advisory.
    """
    if not text:
        return text
    if has_value_link(text):
        return text
    angle = get_angle(angle_key)
    label, url = angle["primary_link"] if angle else ("Learn more", LINK_PROGRAM)
    return f"{text.rstrip()}\n\n{label}: {url}"


# Em/en dashes read as AI-written and are stripped everywhere in outbound copy:
# numeric ranges become hyphens, every other dash becomes a comma. Regular
# hyphens in compound words (air-handling, 20-year) are left untouched.
_DASH_RANGE = re.compile(r"(?<=\d)\s*[–—]\s*(?=\d)")
_DASH_ANY = re.compile(r"\s*[–—]\s*")


def dedash(text: str) -> str:
    if not text:
        return text
    text = _DASH_RANGE.sub("-", text)
    text = _DASH_ANY.sub(", ", text)
    return text


# Blank-safe fallback so copy still reads when a lead carries no signal text.
_SIG_FALLBACK = "the work you have coming up"


def _sig_clause(lead: dict[str, Any]) -> str:
    sig = (lead.get("signal_evidence") or "").strip()
    if not sig:
        return _SIG_FALLBACK
    return sig[:200].rstrip(". ")


# Each angle: key, name, hook (AI voice brief), primary_link (label,url), steps[4].
#
# The keys match apps/api/src/linkedin/ai/prompt.ts, so a LinkedIn post and an
# email sequence drafted on the same angle say the same thing.
#
# The copy is written for a technical, specification-led sale: the reader is an
# engineer, plant or project manager, or the director above them, and they are
# deciding while something is being designed or expanded. It deliberately makes
# no product claim — the product comes from BRAND_BUSINESS_BRIEF on the AI path,
# and from the reader's own context on the template path.
ANGLES: list[dict[str, Any]] = [
    {
        "key": "spec_early",
        "name": "Get Specified Early",
        "hook": "The decision is made at the drawing, not the purchase order. Lead with what it costs to be brought in after the layout is frozen.",
        "primary_link": ("What we do", LINK_PROGRAM),
        "steps": [
            {
                "subject": "{company} — before the layout is frozen",
                "body": (
                    "Hi {fn},\n\n"
                    "Most of the equipment decisions on a project are effectively made at the "
                    "drawing stage. By the time anything reaches purchasing, the envelope, the "
                    "duty and the space have already been fixed, and the only variable left is "
                    "price.\n\n"
                    "I noticed {sig}, which usually means those drawings are being made right "
                    "now at {company}.\n\n"
                    "We work with engineering teams at that point rather than at the quote, so "
                    "the selection fits the process instead of the other way round.\n\n"
                    "What we do: {SITE}\n\n"
                    "Worth a short call while it is still open?\n\n{signer}"
                ),
            },
            {
                "subject": "Re: the expensive part of a late change",
                "body": (
                    "Hi {fn},\n\n"
                    "The thing that makes a late equipment change expensive is rarely the "
                    "equipment. It is the ductwork, the structural steel and the two weeks of "
                    "engineering time that follow it.\n\n"
                    "That is the whole argument for getting the selection right at the drawing.\n\n"
                    "What we do: {SITE}\n\n"
                    "Is there a project at {company} where that is live?\n\n{signer}"
                ),
            },
            {
                "subject": "One question about {company}",
                "body": (
                    "Hi {fn},\n\n"
                    "Simple question and I will stop if the answer is no: is anyone at {company} "
                    "specifying air handling or process ventilation in the next quarter?\n\n"
                    "If yes, I would rather be useful at the drawing than turn up with a quote "
                    "after the fact.\n\n"
                    "What we do: {SITE}\n\n{signer}"
                ),
            },
            {
                "subject": "Closing the loop",
                "body": (
                    "Hi {fn},\n\n"
                    "I will leave this here. If a project comes up where the selection is still "
                    "open, we are worth a call.\n\n"
                    "What we do: {SITE}\n\n"
                    "Happy to be the person you ring when it does.\n\n{signer}"
                ),
            },
        ],
    },
    {
        "key": "expansion_timing",
        "name": "Expansion Timing",
        "hook": "A new line, plant or capacity increase is the only window where equipment choices are genuinely open. Urgency from the calendar, not from scarcity.",
        "primary_link": ("What we do", LINK_PROGRAM),
        "steps": [
            {
                "subject": "{company}'s expansion, and the part that gets rushed",
                "body": (
                    "Hi {fn},\n\n"
                    "I saw {sig}.\n\n"
                    "On an expansion, the process equipment gets months of attention and the air "
                    "handling gets whatever time is left. It is usually the thing that holds up "
                    "commissioning.\n\n"
                    "We get involved early enough that it is not the item on the critical path.\n\n"
                    "What we do: {SITE}\n\n"
                    "Is that on someone's desk at {company} yet?\n\n{signer}"
                ),
            },
            {
                "subject": "Re: the item that holds up commissioning",
                "body": (
                    "Hi {fn},\n\n"
                    "Following up on the expansion. The window where ventilation choices are "
                    "genuinely open is short, and it closes when the general arrangement is "
                    "signed.\n\n"
                    "After that it is a change order.\n\n"
                    "What we do: {SITE}\n\n"
                    "Where is {company} in that sequence?\n\n{signer}"
                ),
            },
            {
                "subject": "Timing at {company}",
                "body": (
                    "Hi {fn},\n\n"
                    "If the expansion is still in design, this is the useful moment. If it is "
                    "already built, it is not, and I will say so rather than sell you something.\n\n"
                    "What we do: {SITE}\n\n"
                    "Which is it?\n\n{signer}"
                ),
            },
            {
                "subject": "Last note on this",
                "body": (
                    "Hi {fn},\n\n"
                    "I will stop here. When the next capacity project starts at {company}, we "
                    "are a useful early call.\n\n"
                    "What we do: {SITE}\n\n{signer}"
                ),
            },
        ],
    },
    {
        "key": "engineering_capacity",
        "name": "Engineering Capacity",
        "hook": "Teams hiring engineers are short of engineering hours. Lead with the workload, not the catalogue.",
        "primary_link": ("What we do", LINK_PROGRAM),
        "steps": [
            {
                "subject": "{company} is hiring engineers",
                "body": (
                    "Hi {fn},\n\n"
                    "I saw {sig}.\n\n"
                    "Teams hiring engineers are usually short of engineering hours, not short of "
                    "vendors. The selection work still has to happen, it just happens at "
                    "eleven at night.\n\n"
                    "We do that part: duty, selection and submittals, so your team reviews rather "
                    "than researches.\n\n"
                    "What we do: {SITE}\n\n"
                    "Useful right now, or ask again in a quarter?\n\n{signer}"
                ),
            },
            {
                "subject": "Re: the hours, not the vendors",
                "body": (
                    "Hi {fn},\n\n"
                    "The offer is narrow and I will keep it that way: hand us the duty and the "
                    "constraints, get back a selection your engineers can check in ten minutes.\n\n"
                    "No obligation attached to it.\n\n"
                    "What we do: {SITE}\n\n"
                    "Anything on {company}'s desk worth trying that on?\n\n{signer}"
                ),
            },
            {
                "subject": "A specific offer",
                "body": (
                    "Hi {fn},\n\n"
                    "Pick the least interesting selection on your list, the one nobody wants to "
                    "do, and send it over. That is the honest test of whether we are useful.\n\n"
                    "What we do: {SITE}\n\n{signer}"
                ),
            },
            {
                "subject": "Closing this out",
                "body": (
                    "Hi {fn},\n\n"
                    "Last one from me. When the workload spikes again, the offer stands.\n\n"
                    "What we do: {SITE}\n\n{signer}"
                ),
            },
        ],
    },
    {
        "key": "lead_times",
        "name": "Lead Times & Availability",
        "hook": "Schedule risk beats unit price on any project with a commissioning date. Concrete about what slips, never a fabricated number.",
        "primary_link": ("What we do", LINK_PROGRAM),
        "steps": [
            {
                "subject": "{company} — the date, not the price",
                "body": (
                    "Hi {fn},\n\n"
                    "On any project with a commissioning date, the equipment that arrives late "
                    "costs more than the equipment that cost more.\n\n"
                    "I saw {sig}.\n\n"
                    "We are straight about what is actually available and what is not, including "
                    "when the answer is that we are the wrong people for it.\n\n"
                    "What we do: {SITE}\n\n"
                    "Is there a date at {company} that this matters to?\n\n{signer}"
                ),
            },
            {
                "subject": "Re: what actually slips",
                "body": (
                    "Hi {fn},\n\n"
                    "It is rarely the headline item. It is the accessory nobody quoted, the "
                    "drive that changed, or the submittal that came back twice.\n\n"
                    "Worth knowing before it is on your programme rather than after.\n\n"
                    "What we do: {SITE}\n\n{signer}"
                ),
            },
            {
                "subject": "Your programme at {company}",
                "body": (
                    "Hi {fn},\n\n"
                    "If you have a live programme, I can tell you which items on it are the "
                    "schedule risk. That is useful whether or not you buy anything.\n\n"
                    "What we do: {SITE}\n\n"
                    "Want me to look?\n\n{signer}"
                ),
            },
            {
                "subject": "Last note",
                "body": (
                    "Hi {fn},\n\n"
                    "Leaving it here. When a date starts looking tight, we are a quick call.\n\n"
                    "What we do: {SITE}\n\n{signer}"
                ),
            },
        ],
    },
    {
        "key": "total_cost",
        "name": "Total Cost of Ownership",
        "hook": "Cheapest installed is rarely cheapest at year ten. Energy, maintenance access and downtime, in the reader's own terms.",
        "primary_link": ("What we do", LINK_PROGRAM),
        "steps": [
            {
                "subject": "The cheapest option at {company}, ten years in",
                "body": (
                    "Hi {fn},\n\n"
                    "Cheapest installed and cheapest to own are different pieces of equipment, "
                    "and only one of them shows up on the bid comparison.\n\n"
                    "The gap is energy, maintenance access and the hours lost when something has "
                    "to come out of a space it was never going to come out of easily.\n\n"
                    "What we do: {SITE}\n\n"
                    "Is anyone at {company} looking at it that way?\n\n{signer}"
                ),
            },
            {
                "subject": "Re: the number that is not on the bid sheet",
                "body": (
                    "Hi {fn},\n\n"
                    "Not arguing against buying on price. Arguing that the price should include "
                    "the ten years after it.\n\n"
                    "It usually changes which option wins, and occasionally it does not.\n\n"
                    "What we do: {SITE}\n\n{signer}"
                ),
            },
            {
                "subject": "Maintenance access at {company}",
                "body": (
                    "Hi {fn},\n\n"
                    "One question worth asking of any selection: how does it come out?\n\n"
                    "If nobody can answer that, the maintenance cost is already decided.\n\n"
                    "What we do: {SITE}\n\n{signer}"
                ),
            },
            {
                "subject": "Closing the loop",
                "body": (
                    "Hi {fn},\n\n"
                    "I will stop here. Worth a call next time a comparison is close.\n\n"
                    "What we do: {SITE}\n\n{signer}"
                ),
            },
        ],
    },
    {
        "key": "application_fit",
        "name": "Application Fit",
        "hook": "A catalogue selection that ignores the process is how equipment gets replaced twice. Duty, environment and what the datasheet does not say.",
        "primary_link": ("What we do", LINK_PROGRAM),
        "steps": [
            {
                "subject": "What the datasheet at {company} does not say",
                "body": (
                    "Hi {fn},\n\n"
                    "Most equipment that gets replaced early was never wrong on paper. It was "
                    "selected off a catalogue curve for a process the curve had not met.\n\n"
                    "I saw {sig}.\n\n"
                    "The questions that matter are the ones underneath the datasheet: what is "
                    "actually in the air, how often the duty moves, what the space does in "
                    "August.\n\n"
                    "What we do: {SITE}\n\n"
                    "Happy to go through one of yours.\n\n{signer}"
                ),
            },
            {
                "subject": "Re: selected right, replaced anyway",
                "body": (
                    "Hi {fn},\n\n"
                    "The pattern is consistent: correct on the curve, wrong in the room.\n\n"
                    "It is worth twenty minutes on a live application to find out which one you "
                    "have.\n\n"
                    "What we do: {SITE}\n\n{signer}"
                ),
            },
            {
                "subject": "A live one at {company}",
                "body": (
                    "Hi {fn},\n\n"
                    "Send me a duty and the environment it sits in and I will tell you where a "
                    "catalogue selection would get it wrong. No quote attached.\n\n"
                    "What we do: {SITE}\n\n{signer}"
                ),
            },
            {
                "subject": "Last note on this",
                "body": (
                    "Hi {fn},\n\n"
                    "Leaving it here. The offer to look at an application stands whenever it is "
                    "useful.\n\n"
                    "What we do: {SITE}\n\n{signer}"
                ),
            },
        ],
    },
    {
        "key": "compliance",
        "name": "Codes, Standards & Compliance",
        "hook": "Speak to the person who signs it off: what the standard requires and where submittals come back.",
        "primary_link": ("What we do", LINK_PROGRAM),
        "steps": [
            {
                "subject": "{company} — where submittals come back",
                "body": (
                    "Hi {fn},\n\n"
                    "Submittals come back for the same handful of reasons, and almost none of "
                    "them are the equipment. They are the documentation around it.\n\n"
                    "We put the package together so it goes through the first time, which is "
                    "worth more than it sounds when it is on the critical path.\n\n"
                    "What we do: {SITE}\n\n"
                    "Is that a friction point at {company}?\n\n{signer}"
                ),
            },
            {
                "subject": "Re: the first-time-through package",
                "body": (
                    "Hi {fn},\n\n"
                    "The standard says what it says. The disagreement is nearly always about "
                    "what evidence satisfies it.\n\n"
                    "Getting that agreed before submission is the whole trick.\n\n"
                    "What we do: {SITE}\n\n{signer}"
                ),
            },
            {
                "subject": "Sign-off at {company}",
                "body": (
                    "Hi {fn},\n\n"
                    "Who signs these off at {company}? If it is you, this is a short and "
                    "genuinely useful conversation.\n\n"
                    "What we do: {SITE}\n\n{signer}"
                ),
            },
            {
                "subject": "Closing this out",
                "body": (
                    "Hi {fn},\n\n"
                    "Last from me. Worth a call next time a package is due.\n\n"
                    "What we do: {SITE}\n\n{signer}"
                ),
            },
        ],
    },
    {
        "key": "retrofit",
        "name": "Retrofit Over Replacement",
        "hook": "Not every problem needs new equipment. The credibility comes from saying when not to buy.",
        "primary_link": ("What we do", LINK_PROGRAM),
        "steps": [
            {
                "subject": "{company} may not need new equipment",
                "body": (
                    "Hi {fn},\n\n"
                    "An unusual opening from someone who sells equipment: a good share of the "
                    "problems we get called about do not need new equipment.\n\n"
                    "They need the existing installation to be doing what it was specified to "
                    "do, which is often a control, a balance or an accessory.\n\n"
                    "We will tell you when that is the case. It is the cheapest way to be worth "
                    "calling twice.\n\n"
                    "What we do: {SITE}\n\n"
                    "Anything at {company} underperforming?\n\n{signer}"
                ),
            },
            {
                "subject": "Re: the cheapest answer",
                "body": (
                    "Hi {fn},\n\n"
                    "Still happy to look at something that is not working properly and tell you "
                    "whether it is a replacement or a fix.\n\n"
                    "No quote unless the answer is genuinely a replacement.\n\n"
                    "What we do: {SITE}\n\n{signer}"
                ),
            },
            {
                "subject": "The one that annoys people at {company}",
                "body": (
                    "Hi {fn},\n\n"
                    "Every plant has one unit everyone complains about. That is the one worth "
                    "sending me.\n\n"
                    "What we do: {SITE}\n\n{signer}"
                ),
            },
            {
                "subject": "Last note",
                "body": (
                    "Hi {fn},\n\n"
                    "I will leave it here. The offer to diagnose before quoting stands.\n\n"
                    "What we do: {SITE}\n\n{signer}"
                ),
            },
        ],
    },
    {
        "key": "field_proof",
        "name": "Field Proof",
        "hook": "Social proof from installations that already run. Concrete and specific, never a fabricated statistic or an unapproved client name.",
        "primary_link": ("What we do", LINK_PROGRAM),
        "steps": [
            {
                "subject": "Installations like {company}'s",
                "body": (
                    "Hi {fn},\n\n"
                    "The useful question about any supplier is not what they sell, it is what of "
                    "theirs has been running for ten years in conditions like yours.\n\n"
                    "We can answer that specifically for the kind of plant {company} runs, "
                    "including the ones that needed work after commissioning.\n\n"
                    "What we do: {SITE}\n\n"
                    "Want the relevant ones?\n\n{signer}"
                ),
            },
            {
                "subject": "Re: what has actually been running",
                "body": (
                    "Hi {fn},\n\n"
                    "Happy to talk through comparable installations, including what we would do "
                    "differently on them now.\n\n"
                    "That second part is usually the more useful half.\n\n"
                    "What we do: {SITE}\n\n{signer}"
                ),
            },
            {
                "subject": "References for {company}",
                "body": (
                    "Hi {fn},\n\n"
                    "If it would help, I can put you in touch with someone running a similar "
                    "installation rather than sending you a case study.\n\n"
                    "What we do: {SITE}\n\n{signer}"
                ),
            },
            {
                "subject": "Closing the loop",
                "body": (
                    "Hi {fn},\n\n"
                    "Last note. The offer to point you at comparable sites stands.\n\n"
                    "What we do: {SITE}\n\n{signer}"
                ),
            },
        ],
    },
    {
        "key": "single_point",
        "name": "One Point of Responsibility",
        "hook": "Multiple vendors means the gaps between them are the customer's problem. Who owns the outcome, not the product range.",
        "primary_link": ("What we do", LINK_PROGRAM),
        "steps": [
            {
                "subject": "Who owns the gaps at {company}",
                "body": (
                    "Hi {fn},\n\n"
                    "When a system comes from four suppliers, the interfaces between them belong "
                    "to nobody, which in practice means they belong to you.\n\n"
                    "I saw {sig}.\n\n"
                    "We take the whole air side so there is one number to ring and one person "
                    "who cannot pass it on.\n\n"
                    "What we do: {SITE}\n\n"
                    "Is that a problem worth solving at {company}?\n\n{signer}"
                ),
            },
            {
                "subject": "Re: one number to ring",
                "body": (
                    "Hi {fn},\n\n"
                    "The value is not the product range. It is that when something does not "
                    "work, the conversation is one conversation.\n\n"
                    "What we do: {SITE}\n\n{signer}"
                ),
            },
            {
                "subject": "The last time it went wrong",
                "body": (
                    "Hi {fn},\n\n"
                    "Worth asking: the last time something on the air side went wrong at "
                    "{company}, how many suppliers were involved in working out whose it was?\n\n"
                    "What we do: {SITE}\n\n{signer}"
                ),
            },
            {
                "subject": "Last one from me",
                "body": (
                    "Hi {fn},\n\n"
                    "Leaving it here. When the next package is being split up, we are worth a "
                    "call.\n\n"
                    "What we do: {SITE}\n\n{signer}"
                ),
            },
        ],
    },
]

_BY_KEY = {a["key"]: a for a in ANGLES}


def list_angles() -> list[dict[str, str]]:
    """[{key, name}] for the UI picker."""
    return [{"key": a["key"], "name": a["name"]} for a in ANGLES]


def get_angle(key: str | None) -> dict[str, Any] | None:
    return _BY_KEY.get(key) if key else None


def pick_angle(lead: dict[str, Any]) -> str:
    """Stable rotation across the 10 angles keyed off the account/company."""
    seed = str(lead.get("account_id") or lead.get("company") or "")
    idx = (sum(ord(c) for c in seed) if seed else 0) % len(ANGLES)
    return ANGLES[idx]["key"]


def render_angle_steps(angle: dict[str, Any], lead: dict[str, Any], signer: str) -> list[dict[str, Any]]:
    """Fill an angle's step templates with this lead's tokens. Returns
    ``[{subject, body}]`` (delays applied by the caller)."""
    person = (lead.get("person_name") or "").strip()
    ctx = {
        "fn": person.split()[0] if person else "there",
        "company": (lead.get("company") or "your team").strip(),
        "sig": _sig_clause(lead),
        "role": (lead.get("job_title") or "").strip(),
        "signer": signer,
        "SITE": LINK_PROGRAM,
        "LINKEDIN_POST": LINK_LINKEDIN_POST,
    }

    def _fill(text: str) -> str:
        for k, v in ctx.items():
            text = text.replace("{" + k + "}", str(v))
        return text

    out: list[dict[str, Any]] = []
    for st in angle["steps"]:
        out.append({
            "subject": dedash(_fill(st["subject"])),
            # Belt and braces. The templates are correct now, but they were
            # correct-looking before too, and nothing checked.
            "body": enforce_approved_links(dedash(_fill(st["body"]))),
        })
    return out


def angle_prompt_brief(angle: dict[str, Any]) -> str:
    """Compact brief handed to the AI so it writes in the angle's voice + link."""
    label, url = angle["primary_link"]
    others = ", ".join(_all_approved())
    business = brand.business_brief()
    context = f"About the business: {business} " if business else ""
    return (
        f"{context}"
        f"Messaging angle: {angle['name']}. Strategy: {angle['hook']} "
        f"Every email in the sequence MUST include this exact value link once as the CTA "
        f"(write it on its own line as 'Label: URL'): {label}: {url}. "
        f"You may also use these and NOTHING else ({others}). Never invent a URL: "
        "any other path on this domain does not exist and lands on a 404."
    )


# Distilled house style, embedded in the AI system prompt so generated copy
# matches the approved voice and shape.
HOUSE_STYLE = (
    "HOUSE STYLE — match this exactly:\n"
    "- Open every email with 'Hi {first_name},' then 2-4 very short paragraphs. "
    "Plain text only: no markdown, no emojis, no bullet characters, no headers.\n"
    "- Voice: direct, human, confident, lightly contrarian. Lead with the reader's world "
    "(their plant, their project, their programme, their budget) before the product. No hype "
    "words, no exclamation-mark selling, no fake stats, no pricing promises, no corporate "
    "filler.\n"
    "- Never claim a specification, a certification, a lead time or a reference customer that "
    "you have not been given. A technical reader checks, and one invented claim ends the "
    "conversation.\n"
    "- Include exactly ONE value link as the call to action, on its own line, written as "
    "'Label: URL' (plain text, no angle brackets, no markdown link syntax).\n"
    "- NEVER use em dashes (—) or en dashes (–). They read as AI-written. Use commas, "
    "periods, or parentheses instead. Regular hyphens in compound words (air-handling, "
    "20-year) are fine.\n"
    "- End with a short, low-pressure question or next step, then sign on the final line as "
    "the sender name only.\n"
    "- Subjects: short, specific, curiosity- or benefit-driven (aim for <= 8 words). Avoid "
    "generic 'Supporting/Helping your team...' openings — write subjects like a real person, "
    "e.g. 'The cheapest option, ten years in'.\n"
    "- The opener earns attention; each follow-up must open a genuinely NEW sub-angle "
    "(timing, the application itself, field proof, cost of ownership, a soft final close) — "
    "never 'just circling back' or 'bumping this up' with no new idea."
)


def angle_reference_block(angle: dict[str, Any], signer: str) -> str:
    """The angle's approved canonical copy, shown to the model as the style exemplar
    to emulate (tokens left as {{...}} so it adapts rather than copies verbatim)."""
    repl = {
        "{fn}": "{{first_name}}",
        "{company}": "{{company}}",
        "{sig}": "{{signal}}",
        "{signer}": signer,
        "{SITE}": LINK_PROGRAM,
    }

    def _show(text: str) -> str:
        for k, v in repl.items():
            text = text.replace(k, v)
        return text

    labels = ["Opener (Day 0)", "Follow-up 1 (+3d)", "Follow-up 2 (+5d)", "Follow-up 3 (+7d)"]
    parts = [
        f"REFERENCE COPY for the '{angle['name']}' angle — this is the exact house voice, "
        "length, structure, CTA style, and sign-off to emulate. Write a FRESH, personalized "
        "variation for THIS lead (do not copy it verbatim), keeping the same value link:\n"
    ]
    for i, st in enumerate(angle["steps"]):
        lbl = labels[i] if i < len(labels) else f"Follow-up {i}"
        parts.append(f"[{lbl}]\nSubject: {dedash(_show(st['subject']))}\n{dedash(_show(st['body']))}")
    return "\n\n".join(parts)


_URL_RE = re.compile(r"https?://[^\s<>\"')]+")
