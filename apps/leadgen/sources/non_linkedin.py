"""Aggregate the non-LinkedIn Milestone 1 sources.

WHAT WAS REMOVED, AND WHY
-------------------------
This used to pull three sources that only make sense for one client: the NCES
school universe, USAspending prevention-grant recipients, and their sub-awards.
They exist to find US high schools and county substance-prevention coalitions.

That is not a source list, it is a customer definition, and running it on any
other instance does not return fewer leads — it returns confidently scored
leads for the wrong industry, written straight into the accounts table beside
the real ones with no way to tell them apart afterwards.

So discovery here is now only what is genuinely generic: the manual
CSV/JSON drop-in. An instance whose lead discovery lives in its own pipeline
service (see the deployment notes) leaves this lane empty on purpose.
"""

from __future__ import annotations

from sources.industry_database import fetch_industry_database


def fetch_non_linkedin_leads() -> list[dict]:
    records: list[dict] = []
    # Manual CSV/JSON drop-in for hand-pulled rows.
    records.extend(fetch_industry_database())
    return records
