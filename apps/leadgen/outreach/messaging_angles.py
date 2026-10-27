"""The 10 messaging angles (opener + 3 follow-ups each), plus per-show angle sets.

Each angle carries its own step sequence with a value-add link in every email.
Bodies use the tokens ``{fn}`` (first name), ``{company}``, ``{sig}``
(signal/evidence, blank-safe), ``{role}`` (job title), ``{signer}`` (sender name),
``{brand}`` (business name), ``{SITE}`` (primary link) and ``{LINK}`` (the
angle's own primary link) — rendered by ``render_angle_steps``.

``EVENT_ANGLE_SETS`` holds copy written for one trade show; ``pick_angle`` routes
a lead tagged ``lead_source_bucket = 'event:<slug>'`` to its show's set, and
those steps carry their own day offsets (``angle_schedule``).

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

import datetime as _dt
import os
import re
from typing import Any
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo

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

# ---------------------------------------------------------------------------
# Per-show angle sets
# ---------------------------------------------------------------------------
#
# A show pool (accounts.lead_source_bucket = 'event:<slug>') gets copy written
# for that show rather than one of the ten general angles. Each set carries the
# show's dates, a static sample lead (the preview falls back to it when the pool
# has no usable row), and angles whose steps carry their own ``day`` offset from
# the opener, so a pre-show cadence can be 1-2 emails a week that stops before
# the doors open (see ``angle_schedule``).
#
# Copy rules are the house ones plus: facts about the business only, no claimed
# meetings, booth visits or reference customers, one link per email.
#
# The WorkBoat link is the public landing page. Like every other link it has to
# be listed in OUTREACH_APPROVED_LINKS, or ``enforce_approved_links`` would
# rewrite it; until it is, the WorkBoat angles fall back to the primary link and
# the approval view says so (``event_landing_url`` returns "" in that case).


def _approved_link_for_path(path: str) -> str:
    """The approved link whose URL path is ``path``, or "" when none is."""
    want = "/" + path.strip("/")
    for u in APPROVED_LINKS:
        if "/" + urlsplit(u).path.strip("/") == want:
            return u
    return ""


_WB_LANDING_PATH = "/workboat-2026"
_WB_LINK = _approved_link_for_path(_WB_LANDING_PATH) or LINK_PROGRAM
_WB_LINK_LABEL = "Workboat ventilation and heating"

# Steps: opener plus six follow-ups, 1-2 a week. Offsets are days after the
# opener; angle_schedule rolls weekends/Thanksgiving forward and clamps the tail
# to the last send day before the show.
_WB_DAYS = (0, 4, 8, 14, 21, 28, 34)
_SEMI_DAYS = (0, 4, 9, 16)


def _steps(days: tuple[int, ...], pairs: list[tuple[str, str]]) -> list[dict[str, Any]]:
    if len(days) != len(pairs):
        raise RuntimeError("messaging_angles: step day offsets do not match the step count")
    return [{"day": d, "subject": s, "body": b} for d, (s, b) in zip(days, pairs)]


_WB_LINE = _WB_LINK_LABEL + ": {LINK}\n\n"
_SEMI_LINE = "What we do: {LINK}\n\n"

_WORKBOAT_ANGLES: list[dict[str, Any]] = [
    {
        "key": "wb_gulf_rep",
        "name": "Your Gulf Coast Rep",
        "hook": "A Houston rep covering Texas and Louisiana is useful to a Gulf Coast operator or yard "
                "in a way a catalogue is not. WorkBoat is the reason to write now, never a claimed meeting.",
        "primary_link": (_WB_LINK_LABEL, _WB_LINK),
        "steps": _steps(_WB_DAYS, [
            ("WorkBoat, and a rep closer to home",
             "Hi {fn},\n\n"
             "With WorkBoat coming up in New Orleans, a lot of Gulf Coast operators and yards are "
             "lining up next year's vessel work.\n\n"
             "I look after Texas and Louisiana for {brand}, a Houston rep for industrial fans, "
             "blowers, dampers, louvers and heaters since 1949. Marine and offshore is the core of "
             "what we do.\n\n"
             "If {company} has ventilation or heating coming up on a boat or in the yard, it helps "
             "to have someone local to help specify it and source it.\n\n"
             + _WB_LINE +
             "Worth a short call before the show?\n\n{signer}"),
            ("Re: a rep on the same coast",
             "Hi {fn},\n\n"
             "One practical point behind my last note. When a supply fan or a heater gives out on a "
             "boat working the Gulf, the useful question is who can get the right replacement "
             "moving, not which catalogue it came from.\n\n"
             "Being in Houston and covering Texas and Louisiana is the whole point of us.\n\n"
             + _WB_LINE +
             "Who looks after ventilation and heating equipment at {company}?\n\n{signer}"),
            ("The lines behind us",
             "Hi {fn},\n\n"
             "A rep is only as useful as the manufacturers behind them. Ours include Hartzell Air "
             "Movement, Loren Cook, Woods Air Movement, Indeeco and American Warming & Ventilating, "
             "among others.\n\n"
             "Between them that covers most of what moves or heats air on a vessel or in a shop: "
             "fans, blowers, dampers, louvers, heaters and make-up air.\n\n"
             + _WB_LINE +
             "Is any of that on {company}'s list this season?\n\n{signer}"),
            ("Specified early, not swapped late",
             "Hi {fn},\n\n"
             "On a new build or a refit, the ventilation is effectively fixed on the drawing long "
             "before anyone orders it. Changing it later means new ducting, new openings and rework "
             "in a space that was already tight.\n\n"
             "We help engineers and builders get the selection right at that stage, not at the "
             "quote.\n\n"
             + _WB_LINE +
             "Is there a boat at {company} where that is still open?\n\n{signer}"),
            ("Before the first cold front",
             "Hi {fn},\n\n"
             "Accommodation heating and shop heaters tend to get looked at in the first cold week of "
             "the year, which is the worst time to be sourcing them.\n\n"
             "If heat or make-up air is on the list for {company}'s boats or yard, now is the calmer "
             "time to sort it.\n\n"
             + _WB_LINE +
             "Anything you already know you will need this winter?\n\n{signer}"),
            ("WorkBoat is close",
             "Hi {fn},\n\n"
             "WorkBoat is close now. We are not on the show floor this year, so if ventilation or "
             "heating is on your list for New Orleans, email is the easiest way to reach me.\n\n"
             "Send me what you are looking at and I will come back with what we would suggest, so "
             "you walk the floor with a short list.\n\n"
             + _WB_LINE +
             "Anything you want me to look at first?\n\n{signer}"),
            ("Closing the loop before New Orleans",
             "Hi {fn},\n\n"
             "I will leave it here. If a fan, heater, damper or louver comes up on a boat or in the "
             "yard at {company}, we are a Houston call away and cover Texas and Louisiana.\n\n"
             + _WB_LINE +
             "If you are going, enjoy New Orleans.\n\n{signer}"),
        ]),
    },
    {
        "key": "wb_engine_room",
        "name": "Engine Room & Accommodation Air",
        "hook": "Engine-room ventilation (combustion air and heat removal), accommodation heating and "
                "ventilation, galley exhaust. Practical, space-constrained, salt air. Talk about the "
                "spaces on the boat; never invent a spec.",
        "primary_link": (_WB_LINK_LABEL, _WB_LINK),
        "steps": _steps(_WB_DAYS, [
            ("{company}: engine room air",
             "Hi {fn},\n\n"
             "On most workboats the engine room fans are doing two jobs at once: feeding the "
             "engines combustion air and pulling heat out so the space stays workable. When either "
             "one falls short, the crew finds out first.\n\n"
             "{brand} is a Houston rep for industrial fans, blowers, dampers, louvers and heaters, "
             "with marine and offshore at the core. I cover Texas and Louisiana.\n\n"
             + _WB_LINE +
             "Is engine room or accommodation air on anyone's list at {company}?\n\n{signer}"),
            ("Re: the accommodation side",
             "Hi {fn},\n\n"
             "The other half of the boat is the accommodation: cabins, galley and wheelhouse, where "
             "heating, ventilation and galley exhaust decide how a crew gets through a long hitch.\n\n"
             "We supply the fans, heaters and dampers for those spaces, and help pick ones that fit "
             "where they have to go.\n\n"
             + _WB_LINE +
             "Which side gives {company} more trouble, engine room or accommodation?\n\n{signer}"),
            ("Salt air and small spaces",
             "Hi {fn},\n\n"
             "Two things make marine air equipment different from a plant job: it has to fit a space "
             "that was drawn tight, and it lives in salt air.\n\n"
             "Both are selection questions, and both are easier to get right before the order than "
             "after the install.\n\n"
             + _WB_LINE +
             "What is the hardest space to ventilate on your boats?\n\n{signer}"),
            ("Louvers and dampers, the quiet part",
             "Hi {fn},\n\n"
             "Fans get the attention, but the louvers and dampers on the intake and exhaust decide "
             "how much air actually gets through, and how well weather stays out.\n\n"
             "We carry those as well as the fans, so the openings and the airflow get sized "
             "together.\n\n"
             + _WB_LINE +
             "Worth a look on {company}'s next boat?\n\n{signer}"),
            ("A heater question for {company}",
             "Hi {fn},\n\n"
             "Marine and industrial heaters tend to get sourced in a hurry, the week the first cold "
             "front comes through. We represent heater lines such as Indeeco and American Warming & "
             "Ventilating alongside the fans.\n\n"
             "If any of {company}'s boats or shops need heat this winter, now is the calmer time to "
             "look.\n\n"
             + _WB_LINE +
             "Anything on the list already?\n\n{signer}"),
            ("Before you go to New Orleans",
             "Hi {fn},\n\n"
             "WorkBoat is close now. We are not exhibiting this year, so if engine room or "
             "accommodation air is on your list for the show, send me the space and the problem and "
             "I will come back with a suggestion before you go.\n\n"
             + _WB_LINE +
             "Worth doing before the show?\n\n{signer}"),
            ("Last note from me",
             "Hi {fn},\n\n"
             "Last note from me before the show. If engine room ventilation, accommodation heating "
             "or galley exhaust comes up at {company}, we are in Houston and cover Texas and "
             "Louisiana.\n\n"
             + _WB_LINE +
             "Happy to be the call you make when it does.\n\n{signer}"),
        ]),
    },
    {
        "key": "wb_pre_show",
        "name": "Before WorkBoat",
        "hook": "The show is the deadline. Help the reader arrive in New Orleans with the ventilation "
                "and heating question already framed. We are not exhibiting, so the offer is to do the "
                "homework by email or phone beforehand; never imply a booth or a meeting at the show.",
        "primary_link": (_WB_LINK_LABEL, _WB_LINK),
        "steps": _steps(_WB_DAYS, [
            ("Before you walk WorkBoat",
             "Hi {fn},\n\n"
             "If {company} is heading to WorkBoat in New Orleans, the floor is a good place to see "
             "equipment and a hard place to work out what you actually need.\n\n"
             "If ventilation, heating or dust collection is on the list, I can help you frame it "
             "before you go: the space, the duty, what is there now. You arrive with a short list "
             "instead of a bag of brochures.\n\n"
             "I look after Texas and Louisiana for {brand} in Houston.\n\n"
             + _WB_LINE +
             "Worth doing before December?\n\n{signer}"),
            ("Re: three questions before the show",
             "Hi {fn},\n\n"
             "Three things worth knowing before you talk to any fan or heater supplier at the show: "
             "what space it serves, how much air or heat it has to move, and how much room there is "
             "to put it.\n\n"
             "With those written down, every conversation on the floor gets more useful.\n\n"
             + _WB_LINE +
             "Want me to help pin those down for {company}?\n\n{signer}"),
            ("Not on the floor this year",
             "Hi {fn},\n\n"
             "To be straight with you: we are not exhibiting at WorkBoat this year. Our patch is "
             "Texas and Louisiana, and we would rather be useful close to home than stand at a "
             "booth.\n\n"
             "So the easiest way to use us is before the show, by email or phone.\n\n"
             + _WB_LINE +
             "Is there something I can look at for {company} ahead of it?\n\n{signer}"),
            ("A short list for New Orleans",
             "Hi {fn},\n\n"
             "If it helps, reply with the one piece of air equipment {company} is most likely to buy "
             "next year, and I will send back what we would look at for it.\n\n"
             "No catalogue dump, just the short list.\n\n"
             + _WB_LINE +
             "What is top of the list?\n\n{signer}"),
            ("What to ask the fan makers",
             "Hi {fn},\n\n"
             "A few questions worth asking any fan or blower maker you meet at WorkBoat: how is it "
             "protected for salt air, what does it need for space and access, and who looks after "
             "it on the Gulf Coast.\n\n"
             "The last one is where a local rep earns their keep.\n\n"
             + _WB_LINE +
             "Who would {company} call today?\n\n{signer}"),
            ("Nearly show time",
             "Hi {fn},\n\n"
             "WorkBoat is nearly here. If there is still a ventilation or heating item without an "
             "answer at {company}, send it over and I will come back before you travel.\n\n"
             + _WB_LINE +
             "Anything still open?\n\n{signer}"),
            ("After the show, too",
             "Hi {fn},\n\n"
             "Last note before New Orleans. If something you see at the show needs specifying or "
             "sourcing afterwards, the Texas and Louisiana side of that is what we do from Houston.\n\n"
             + _WB_LINE +
             "Safe travels, and I would be glad to hear what you find.\n\n{signer}"),
        ]),
    },
    {
        "key": "wb_yard_projects",
        "name": "Shipyard, Repair & Refit",
        "hook": "Newbuilds, repowers and refits at Gulf yards. The ventilation decision is made on the "
                "drawing or during the repower, and the yard itself (welding fume, dust collection, "
                "make-up air, heat) needs air too. For yard, project and engineering leads.",
        "primary_link": (_WB_LINK_LABEL, _WB_LINK),
        "steps": _steps(_WB_DAYS, [
            ("{company}: refits and the air side",
             "Hi {fn},\n\n"
             "When a boat comes in for a repower or refit, the engines get the attention and the "
             "ventilation gets whatever is left in the budget and the schedule. It can end up as the "
             "item that holds up getting the boat back out.\n\n"
             "{brand} is a Houston rep for industrial fans, blowers, dampers, louvers and heaters, "
             "with marine and offshore at the core. I cover Texas and Louisiana.\n\n"
             + _WB_LINE +
             "Is there a refit or newbuild at {company} where that is live?\n\n{signer}"),
            ("Re: new engines, same fans?",
             "Hi {fn},\n\n"
             "A repower changes what the engine room needs. New engines can want different "
             "combustion air and give off different heat, while the fans and louvers were sized for "
             "the old ones.\n\n"
             "Checking that on the drawing is cheap. Finding it at sea trials is not.\n\n"
             + _WB_LINE +
             "Any repowers on {company}'s schedule?\n\n{signer}"),
            ("The yard needs air too",
             "Hi {fn},\n\n"
             "The boats are not the only thing that needs air. Fab shops and covered bays need "
             "welding fume extraction, dust collection, make-up air and heat, and that equipment "
             "works hard.\n\n"
             "We supply that side as well, and Texas and Louisiana are our patch.\n\n"
             + _WB_LINE +
             "How is the shop side holding up at {company}?\n\n{signer}"),
            ("Getting it on the drawing",
             "Hi {fn},\n\n"
             "On a newbuild, the fan and louver selections are effectively fixed when the general "
             "arrangement is signed. After that, every change is a change order.\n\n"
             "We help engineers and builders at the drawing stage, so the selection fits the space "
             "instead of the other way round.\n\n"
             + _WB_LINE +
             "Where is {company}'s next build in that sequence?\n\n{signer}"),
            ("Boats due in after the holidays",
             "Hi {fn},\n\n"
             "If {company} has boats due in the yard after the holidays, the ventilation and heating "
             "replacements are easier to line up now than in January.\n\n"
             "Send me the list and I will come back with what we would look at.\n\n"
             + _WB_LINE +
             "Anything already on it?\n\n{signer}"),
            ("Before the show",
             "Hi {fn},\n\n"
             "With WorkBoat close, if there is a refit, repower or newbuild at {company} where the air "
             "side is still open, send me what you have and I will come back with a suggestion before "
             "you head to New Orleans.\n\n"
             "We are not exhibiting this year, so this is the easiest way to reach us.\n\n"
             + _WB_LINE +
             "Worth a look?\n\n{signer}"),
            ("Closing the loop",
             "Hi {fn},\n\n"
             "I will leave this here. When a refit or newbuild at {company} gets to fans, louvers, "
             "dampers or heaters, we are in Houston and cover Texas and Louisiana.\n\n"
             + _WB_LINE +
             "Happy to be the call you make when it does.\n\n{signer}"),
        ]),
    },
]

_SEMICON_ANGLES: list[dict[str, Any]] = [
    {
        "key": "semi_after_show",
        "name": "After SEMICON West",
        "hook": "The show is over and the projects discussed there turn into drawings; the facility "
                "side (exhaust, make-up air, ventilation) comes up fast. Never claim we met at the show.",
        "primary_link": ("What we do", LINK_PROGRAM),
        "steps": _steps(_SEMI_DAYS, [
            ("After SEMICON West",
             "Hi {fn},\n\n"
             "Now that SEMICON West is over, the projects talked about in San Francisco start "
             "turning into drawings, and the facility side of them comes up fast.\n\n"
             "I look after Texas and Louisiana for {brand}, a Houston rep for industrial fans, "
             "blowers, dampers, louvers, heaters, make-up air and dust collection since 1949.\n\n"
             + _SEMI_LINE +
             "Is anything from the show heading for a Texas site at {company}?\n\n{signer}"),
            ("Re: the facility side",
             "Hi {fn},\n\n"
             "The tools get the attention at a show like SEMICON. The exhaust, make-up air and "
             "ventilation that let them run get decided later, usually under schedule pressure.\n\n"
             "We help engineers and contractors specify that equipment early enough that it is not "
             "the item holding up the install.\n\n"
             + _SEMI_LINE +
             "Who owns that side at {company}?\n\n{signer}"),
            ("Texas projects",
             "Hi {fn},\n\n"
             "A lot of new semiconductor capacity is being built in Texas, and every one of those "
             "projects needs air moved, exhausted and conditioned.\n\n"
             "If {company} has people or projects in Texas or Louisiana, a local rep saves a lot of "
             "back and forth.\n\n"
             + _SEMI_LINE +
             "Anything in the state on your calendar?\n\n{signer}"),
            ("Closing the loop",
             "Hi {fn},\n\n"
             "I will leave it here. If a fan, blower, damper or make-up air unit comes up on a Texas "
             "or Louisiana project at {company}, we are a Houston call away.\n\n"
             + _SEMI_LINE +
             "Happy to be the call you make when it does.\n\n{signer}"),
        ]),
    },
    {
        "key": "semi_new_capacity",
        "name": "New Fab & Line Capacity",
        "hook": "New fabs and line expansions are the window where air-handling choices are genuinely "
                "open. Urgency from the project calendar, not from scarcity.",
        "primary_link": ("What we do", LINK_PROGRAM),
        "steps": _steps(_SEMI_DAYS, [
            ("{company}: new capacity and the air side",
             "Hi {fn},\n\n"
             "On a new fab or a line expansion, the process tools get months of attention and the "
             "exhaust and make-up air get whatever time is left.\n\n"
             "{brand} is a Houston rep for industrial fans, blowers, dampers, louvers and make-up "
             "air. I cover Texas and Louisiana, and we get involved early enough that the air side "
             "is not on the critical path.\n\n"
             + _SEMI_LINE +
             "Is new capacity on the plan at {company}?\n\n{signer}"),
            ("Re: when the choices close",
             "Hi {fn},\n\n"
             "The window where exhaust and ventilation choices are genuinely open is short. It closes "
             "when the layout and the utility routing are frozen.\n\n"
             "After that it is a change order, and in a cleanroom building a change order is "
             "rarely small.\n\n"
             + _SEMI_LINE +
             "Where is your next project in that sequence?\n\n{signer}"),
            ("One question about {company}",
             "Hi {fn},\n\n"
             "Simple question and I will stop if the answer is no: is anyone at {company} specifying "
             "exhaust fans, dampers or make-up air for a Texas or Louisiana site in the next year?\n\n"
             "If yes, I would rather be useful at the drawing than turn up with a quote after the "
             "fact.\n\n"
             + _SEMI_LINE + "{signer}"),
            ("Last one from me",
             "Hi {fn},\n\n"
             "Leaving it here. When the next expansion reaches the air side, we are worth a call "
             "from Houston.\n\n"
             + _SEMI_LINE + "{signer}"),
        ]),
    },
    {
        "key": "semi_process_exhaust",
        "name": "Process Exhaust (acid, solvent, general)",
        "hook": "Acid, solvent and general exhaust are separate streams, and the fan, damper and "
                "construction choice follows what is in the air. Never name a material, rating or "
                "certification we have not been given.",
        "primary_link": ("What we do", LINK_PROGRAM),
        "steps": _steps(_SEMI_DAYS, [
            ("Acid, solvent and general exhaust",
             "Hi {fn},\n\n"
             "In a fab, exhaust is three different problems: acid, solvent and general. Each stream "
             "wants its own fan, damper and construction choice, and getting that wrong shows up as "
             "corrosion or downtime.\n\n"
             "{brand} is a Houston rep for industrial fans, blowers and dampers. I cover Texas and "
             "Louisiana.\n\n"
             + _SEMI_LINE +
             "Is exhaust on anyone's desk at {company} right now?\n\n{signer}"),
            ("Re: what is in the air",
             "Hi {fn},\n\n"
             "The right exhaust fan starts with what is in the airstream, not with the airflow "
             "number. Two fans with the same duty can be very different machines once corrosion "
             "and safety come into it.\n\n"
             "That is the conversation we like to have before the selection is made.\n\n"
             + _SEMI_LINE +
             "Which stream gives {company} the most trouble?\n\n{signer}"),
            ("Dampers, the part that gets missed",
             "Hi {fn},\n\n"
             "Exhaust systems get specified around the fans, but the dampers decide how well the "
             "system balances and isolates, and they live in the same airstream.\n\n"
             "We carry both, so they get chosen together.\n\n"
             + _SEMI_LINE +
             "Worth a look on your next tie-in?\n\n{signer}"),
            ("Closing the loop",
             "Hi {fn},\n\n"
             "I will leave this here. If acid, solvent or general exhaust comes up on a Texas or "
             "Louisiana project at {company}, we are worth a call.\n\n"
             + _SEMI_LINE +
             "Happy to be the person you ring when it does.\n\n{signer}"),
        ]),
    },
    {
        "key": "semi_tool_install",
        "name": "Tool Install & Site Readiness",
        "hook": "For tool makers and equipment builders: the fans and blowers inside their tools, and "
                "the exhaust and air their customers' sites must have ready when a tool lands in Texas.",
        "primary_link": ("What we do", LINK_PROGRAM),
        "steps": _steps(_SEMI_DAYS, [
            ("When {company}'s tools land in Texas",
             "Hi {fn},\n\n"
             "A tool is only as ready as the site it lands in. Exhaust, make-up air and ventilation "
             "at the customer's fab decide how quickly it gets up and running.\n\n"
             "I look after Texas and Louisiana for {brand}, a Houston rep for industrial fans, "
             "blowers, dampers and make-up air. We help equipment builders and their customers get "
             "that side specified.\n\n"
             + _SEMI_LINE +
             "Does {company} have installs coming up in Texas?\n\n{signer}"),
            ("Re: the blowers inside the tool",
             "Hi {fn},\n\n"
             "The other side of it is the equipment inside your own tools. Equipment builders use us "
             "to specify and source the fans and blowers that go into what they build.\n\n"
             "If {company} builds anything that moves air, that is a conversation worth having.\n\n"
             + _SEMI_LINE +
             "Who looks after that at {company}?\n\n{signer}"),
            ("Site readiness checklists",
             "Hi {fn},\n\n"
             "When an install slips, the reason is often on the facility side: an exhaust connection "
             "not ready, a fan not delivered, make-up air not balanced.\n\n"
             "If your field team hands customers a site readiness list, a local rep for the air "
             "side can take some of that off them in Texas and Louisiana.\n\n"
             + _SEMI_LINE +
             "Worth a short call?\n\n{signer}"),
            ("Last one from me",
             "Hi {fn},\n\n"
             "Leaving it here. When a {company} install in Texas or Louisiana gets to fans, dampers "
             "or make-up air, we are a Houston call away.\n\n"
             + _SEMI_LINE + "{signer}"),
        ]),
    },
    {
        "key": "semi_uptime",
        "name": "Uptime & Redundancy",
        "hook": "An exhaust fan failure stops production. Redundancy, spares and a local rep who can "
                "get the replacement moving. No invented lead times or reliability figures.",
        "primary_link": ("What we do", LINK_PROGRAM),
        "steps": _steps(_SEMI_DAYS, [
            ("When an exhaust fan stops",
             "Hi {fn},\n\n"
             "In a fab, an exhaust fan is not a building service. When it stops, the tools behind it "
             "stop too.\n\n"
             "{brand} is a Houston rep for industrial fans, blowers and dampers. I cover Texas and "
             "Louisiana, and we help facility teams plan redundancy and spares before they need "
             "them.\n\n"
             + _SEMI_LINE +
             "How is {company} covered today?\n\n{signer}"),
            ("Re: the spare on the shelf",
             "Hi {fn},\n\n"
             "The cheapest uptime is usually a spare motor, a spare wheel or a standby fan already "
             "on site, chosen while nothing is on fire.\n\n"
             "Happy to go through what is critical at {company} and what we would keep in reach.\n\n"
             + _SEMI_LINE +
             "Worth an hour?\n\n{signer}"),
            ("A local call",
             "Hi {fn},\n\n"
             "When something does fail, the useful question is who can get the right replacement "
             "moving. Being in Houston and covering Texas and Louisiana is the point of us.\n\n"
             + _SEMI_LINE +
             "Who would {company} call today?\n\n{signer}"),
            ("Closing the loop",
             "Hi {fn},\n\n"
             "I will leave this here. If exhaust uptime comes up at {company}'s Texas or Louisiana "
             "sites, we are worth a call.\n\n"
             + _SEMI_LINE + "{signer}"),
        ]),
    },
    {
        "key": "semi_makeup_air",
        "name": "Makeup Air & Energy",
        "hook": "Every cubic foot exhausted has to be replaced with conditioned make-up air, which is "
                "one of the larger energy loads in a fab. Lead with the balance, never with invented "
                "savings figures.",
        "primary_link": ("What we do", LINK_PROGRAM),
        "steps": _steps(_SEMI_DAYS, [
            ("{company}: the air you have to replace",
             "Hi {fn},\n\n"
             "Every cubic foot a fab exhausts has to come back in as make-up air, filtered and "
             "conditioned. That makes the exhaust and make-up air balance one of the bigger energy "
             "lines in the building.\n\n"
             "{brand} is a Houston rep for industrial fans, dampers and make-up air. I cover Texas "
             "and Louisiana.\n\n"
             + _SEMI_LINE +
             "Is that balance being looked at anywhere at {company}?\n\n{signer}"),
            ("Re: exhaust you do not need",
             "Hi {fn},\n\n"
             "The make-up air you never have to condition is the exhaust you never pulled. Dampers "
             "and fan selection decide how closely exhaust follows what the tools actually need.\n\n"
             "That is the side of it we work on.\n\n"
             + _SEMI_LINE +
             "Any upgrades on {company}'s list this year?\n\n{signer}"),
            ("Texas summers",
             "Hi {fn},\n\n"
             "In Texas the make-up air has to be cooled and dried for most of the year, which is "
             "where the energy goes.\n\n"
             "If {company} has a site in Texas or Louisiana, it is worth a look at how the make-up "
             "air units are sized and controlled.\n\n"
             + _SEMI_LINE +
             "Worth a short call?\n\n{signer}"),
            ("Last one from me",
             "Hi {fn},\n\n"
             "Leaving it here. When make-up air or exhaust comes up at {company}, we are a Houston "
             "call away.\n\n"
             + _SEMI_LINE + "{signer}"),
        ]),
    },
]

#: Per-show angle sets, keyed by the pool slug (lead_source_bucket 'event:<slug>').
EVENT_ANGLE_SETS: dict[str, dict[str, Any]] = {
    "workboat-2026": {
        "show": "International WorkBoat Show 2026",
        "show_dates": ("2026-12-02", "2026-12-04"),
        "location": "New Orleans, LA",
        # Pre-show cadence: every step lands on a send day before the doors open.
        "send_before_show": True,
        "landing_path": _WB_LANDING_PATH,
        "sample": {
            "account_id": 0,
            "company": "Bayou Marine Services",
            "person_name": "Jordan Thibodeaux",
            "job_title": "Port Engineer",
            "location": "Houma, LA",
            "lead_source_bucket": "event:workboat-2026",
        },
        "angles": _WORKBOAT_ANGLES,
    },
    "semicon-2026": {
        "show": "SEMICON West 2026",
        "show_dates": ("2026-10-13", "2026-10-15"),
        "location": "Moscone Center, San Francisco, CA",
        # Post-show follow-up: no cut-off.
        "send_before_show": False,
        "landing_path": "",
        "sample": {
            "account_id": 0,
            "company": "Lone Star Fab Systems",
            "person_name": "Sam Rivera",
            "job_title": "Facilities Engineering Manager",
            "location": "Austin, TX",
            "lead_source_bucket": "event:semicon-2026",
        },
        "angles": _SEMICON_ANGLES,
    },
}


def _build_index() -> dict[str, dict[str, Any]]:
    """Every angle by key, general and per-show. Fails at import on a collision:
    a key that resolved to two different angles would silently draft one show's
    copy for another show's lead."""
    index: dict[str, dict[str, Any]] = {}
    for a in ANGLES:
        if a["key"] in index:
            raise RuntimeError(f"messaging_angles: duplicate angle key {a['key']!r}")
        index[a["key"]] = a
    for slug, ev in EVENT_ANGLE_SETS.items():
        for a in ev["angles"]:
            if a["key"] in index:
                raise RuntimeError(
                    f"messaging_angles: event angle {a['key']!r} ({slug}) collides with an existing key"
                )
            days = [st.get("day") for st in a["steps"]]
            if any(d is None for d in days) or days != sorted(set(days)) or days[0] != 0:
                raise RuntimeError(f"messaging_angles: {a['key']!r} needs strictly rising day offsets from 0")
            a["event"] = slug
            index[a["key"]] = a
    return index


_BY_KEY = _build_index()


def all_angles() -> list[dict[str, Any]]:
    """The ten general angles followed by every per-show angle."""
    return list(_BY_KEY.values())


def event_slug_of(lead: dict[str, Any] | None) -> str:
    """The show slug a lead is tagged with ('event:<slug>'), or ""."""
    bucket = str((lead or {}).get("lead_source_bucket") or "").strip().lower()
    return bucket[len("event:"):] if bucket.startswith("event:") else ""


def event_angle_set(slug: str) -> dict[str, Any] | None:
    return EVENT_ANGLE_SETS.get((slug or "").strip().lower())


def event_landing_url(slug: str) -> str:
    """The show's approved landing page, or "" when it has none or it is not
    yet listed in OUTREACH_APPROVED_LINKS."""
    ev = event_angle_set(slug)
    path = (ev or {}).get("landing_path") or ""
    return _approved_link_for_path(path) if path else ""


def _angles_for(lead: dict[str, Any] | None) -> list[dict[str, Any]]:
    ev = event_angle_set(event_slug_of(lead))
    return ev["angles"] if ev else ANGLES


def list_angles(lead: dict[str, Any] | None = None) -> list[dict[str, str]]:
    """[{key, name}] for the UI picker: the lead's show set first when it belongs
    to a show pool that has one, then the ten."""
    ev = event_angle_set(event_slug_of(lead))
    return [{"key": a["key"], "name": a["name"]} for a in [*(ev["angles"] if ev else []), *ANGLES]]


def get_angle(key: str | None) -> dict[str, Any] | None:
    return _BY_KEY.get(key) if key else None


def pick_angle(lead: dict[str, Any]) -> str:
    """Stable rotation keyed off the account/company: across the lead's show set
    when it is tagged 'event:<slug>' and that show has one, else across the ten."""
    pool = _angles_for(lead)
    seed = str(lead.get("account_id") or lead.get("company") or "")
    idx = (sum(ord(c) for c in seed) if seed else 0) % len(pool)
    return pool[idx]["key"]


# --- Send-date schedule for angles whose steps carry day offsets ------------

_TZ = "America/Chicago"


def _thanksgiving(year: int) -> _dt.date:
    nov1 = _dt.date(year, 11, 1)
    return nov1 + _dt.timedelta(days=(3 - nov1.weekday()) % 7 + 21)


def _is_send_day(d: _dt.date) -> bool:
    if d.weekday() >= 5:
        return False
    tg = _thanksgiving(d.year)
    return d not in (tg, tg + _dt.timedelta(days=1))


def _roll_forward(d: _dt.date) -> _dt.date:
    while not _is_send_day(d):
        d += _dt.timedelta(days=1)
    return d


def _roll_back(d: _dt.date) -> _dt.date:
    while not _is_send_day(d):
        d -= _dt.timedelta(days=1)
    return d


def today_local() -> _dt.date:
    return _dt.datetime.now(ZoneInfo(_TZ)).date()


def next_send_day(after: _dt.date | None = None) -> _dt.date:
    """The first weekday (not Thanksgiving or the day after) strictly after ``after``."""
    return _roll_forward((after or today_local()) + _dt.timedelta(days=1))


def angle_schedule(angle: dict[str, Any], start: _dt.date | None = None) -> list[dict[str, Any]]:
    """Dated send plan for an angle whose steps carry ``day`` offsets.

    ``start`` is the opener's send day (default: the next send day after today).
    Each later step lands ``day`` days after it, rolled forward off weekends and
    Thanksgiving. For a pre-show set the tail is clamped to the last send day
    before the show opens, keeping at least two days between emails; a follow-up
    that no longer fits is marked ``skipped`` rather than doubled up. Returns one
    entry per step: ``{day, date, delay_after_prev_days, skipped}`` (``date`` is
    None when skipped). Empty for angles without offsets.
    """
    steps = angle.get("steps") or []
    if not steps or any(st.get("day") is None for st in steps):
        return []
    start = _roll_forward(start or next_send_day())
    one, two = _dt.timedelta(days=1), _dt.timedelta(days=2)
    dates: list[_dt.date] = []
    for st in steps:
        d = _roll_forward(start + _dt.timedelta(days=int(st["day"])))
        if dates and d <= dates[-1]:
            d = _roll_forward(dates[-1] + one)
        dates.append(d)

    ev = event_angle_set(angle.get("event") or "")
    cutoff: _dt.date | None = None
    if ev and ev.get("send_before_show"):
        cutoff = _roll_back(_dt.date.fromisoformat(ev["show_dates"][0]) - one)
        limit = cutoff
        for i in range(len(dates) - 1, -1, -1):
            if dates[i] > limit:
                dates[i] = _roll_back(limit)
            limit = _roll_back(dates[i] - two)
        dates[0] = start

    out: list[dict[str, Any]] = []
    last: _dt.date | None = None
    for st, d in zip(steps, dates):
        skipped = (
            bool(cutoff and (start > cutoff or d > cutoff))
            or d < start
            or (last is not None and d < last + two)
        )
        out.append({
            "day": int(st["day"]),
            "date": None if skipped else d.isoformat(),
            "delay_after_prev_days": 0 if last is None or skipped else (d - last).days,
            "skipped": skipped,
        })
        if not skipped:
            last = d
    return out


def render_angle_steps(
    angle: dict[str, Any],
    lead: dict[str, Any],
    signer: str,
    *,
    start: _dt.date | None = None,
    include_skipped: bool = False,
) -> list[dict[str, Any]]:
    """Fill an angle's step templates with this lead's tokens. Returns
    ``[{subject, body}]``; general-angle delays are applied by the caller.

    Steps that carry a ``day`` offset (the per-show sets) also come back with
    ``day``, ``send_date``, ``skipped`` and their own ``delay_after_prev_days``
    from ``angle_schedule``, which callers must use instead of the generic gaps.
    Skipped steps (no room before the show) are left out unless
    ``include_skipped``.
    """
    person = (lead.get("person_name") or "").strip()
    first = person.split()[0] if person else "there"
    ctx = {
        # Show registrations arrive in capitals ("SUSANNE BURSTEIN"); "Hi SUSANNE," reads as shouting.
        "fn": first.title() if first.isupper() else first,
        "company": (lead.get("company") or "your team").strip(),
        "sig": _sig_clause(lead),
        "role": (lead.get("job_title") or "").strip(),
        "signer": signer,
        "brand": brand.name(),
        "SITE": LINK_PROGRAM,
        "LINK": (angle.get("primary_link") or ("", LINK_PROGRAM))[1],
        "LINKEDIN_POST": LINK_LINKEDIN_POST,
    }

    def _fill(text: str) -> str:
        for k, v in ctx.items():
            text = text.replace("{" + k + "}", str(v))
        return text

    schedule = angle_schedule(angle, start)
    out: list[dict[str, Any]] = []
    for i, st in enumerate(angle["steps"]):
        step: dict[str, Any] = {
            "subject": dedash(_fill(st["subject"])),
            # Belt and braces. The templates are correct now, but they were
            # correct-looking before too, and nothing checked.
            "body": enforce_approved_links(dedash(_fill(st["body"]))),
        }
        if schedule:
            plan = schedule[i]
            if plan["skipped"] and not include_skipped:
                continue
            step.update({
                "day": plan["day"],
                "send_date": plan["date"],
                "skipped": plan["skipped"],
                "delay_after_prev_days": plan["delay_after_prev_days"],
            })
        out.append(step)
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
        "{LINK}": (angle.get("primary_link") or ("", LINK_PROGRAM))[1],
        "{brand}": brand.name(),
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
        if st.get("day") is not None:
            lbl = "Opener (Day 0)" if i == 0 else f"Follow-up {i} (day {st['day']})"
        else:
            lbl = labels[i] if i < len(labels) else f"Follow-up {i}"
        parts.append(f"[{lbl}]\nSubject: {dedash(_show(st['subject']))}\n{dedash(_show(st['body']))}")
    return "\n\n".join(parts)


_URL_RE = re.compile(r"https?://[^\s<>\"')]+")
