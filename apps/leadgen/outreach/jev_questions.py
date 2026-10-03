"""Versioned Jev rubric library for Knape Associates lead generation.

Each builder returns a ``{question_id: jev question}`` dict for one stage of the
playbook, ready to hand to ``jev_llm.jev_decide``. Every judgment is atomic (one
decision) so a stage runs all of its questions in a single request.

Knape Associates is a Houston specialty INDUSTRIAL AIR-MOVEMENT equipment
representative / distributor (founded 1949): fans, blowers, dampers, louvers,
heaters, make-up air, dust collectors and air-handling, sold through engineers,
contractors, facility operators and OEMs across industrial, oil & gas, marine,
healthcare, multifamily, power/nuclear, wastewater and commercial-kitchen
markets. It specifies and sources equipment; it does not manufacture or install.
That business shapes every rubric below. The taxonomy lives in ``KNAPE_ICP``
(data, not logic) and can be overridden by ``data/knape_icp.json``.

Bump ``RUBRIC_VERSION`` on ANY change to options or instructions: a changed
rubric can shift lead distributions even on identical source data, so every
stored semantic field records the version that produced it.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from outreach.jev_llm import choice, noul, score

RUBRIC_VERSION = "knape-airmove-v1"

KNAPE_ICP: dict[str, Any] = {
    # The market/application the company operates in (ICP-01).
    "applications": {
        "industrial_manufacturing": "Factories, plants, mills, foundries, process manufacturing.",
        "oil_gas": "Oil, gas, petrochemical, refining, LNG, classified/hazardous areas.",
        "marine_offshore": "Ships, shipyards, offshore platforms, vessels, marine facilities.",
        "healthcare": "Hospitals and healthcare facilities with specialized ventilation.",
        "multifamily_highrise": "Apartments, high-rise, parking garage and common-area ventilation.",
        "power_nuclear": "Power plants, nuclear, generator rooms, e-houses, critical ventilation.",
        "wastewater": "Water/wastewater treatment plants (corrosive, odor, hazardous gas).",
        "commercial_kitchen": "Restaurants and institutional/industrial kitchens (exhaust, make-up air).",
        "tunnel_ehouse": "Tunnel ventilation, e-houses, enclosures.",
        "oem": "OEMs building machines/products that need a ventilation or air-moving component.",
        "other": "No Knape target application fits the evidence.",
    },
    # Who the company is to Knape (new dimension, drives buyer mapping).
    "customer_types": {
        "engineering_mep_firm": "Engineering or MEP/process design firm that specifies equipment.",
        "mechanical_contractor": "Mechanical/HVAC contractor that installs and procures equipment.",
        "general_contractor": "General/construction contractor procuring specified equipment.",
        "facility_plant_operator": "Owns/operates a facility, plant, ship or building needing equipment.",
        "oem_builder": "Builds machines/products and needs air-moving components.",
        "procurement_team": "Procurement/purchasing function sourcing specified equipment.",
        "other": "None of these customer types fit.",
    },
    # What Knape would sell them (OFFER-01).
    "offer_families": {
        "fans_blowers": "Fans and blowers (axial, centrifugal, pressure, explosion-proof, etc.).",
        "dampers_louvers": "Dampers and louvers (control, fire/smoke, marine, FRP, actuators).",
        "heaters": "Industrial heaters (duct, immersion, explosion-proof, unit, fin-tube).",
        "make_up_air": "Make-up air units and systems.",
        "air_handling": "Air-handling units, heat exchangers, broader air-management systems.",
        "dust_collection": "Dust collectors (cyclone, baghouse) and air-quality equipment.",
        "specialty_equipment": "Specialty/marine/explosion-proof or other specialized equipment.",
        "engineering_sourcing": "Application engineering, equipment audit, spec/sizing or sourcing help.",
        "none": "No Knape offer family maps to this lead.",
    },
    # Contact's relationship to the purchase (BUYER-01), Knape's buying chain.
    "buyer_roles": {
        "decision_maker": "Owns or authorizes the budget (owner, VP, plant/ops director, procurement head).",
        "engineer_specifier": "Specifies the equipment (MEP/process/plant/project engineer).",
        "contractor_procurer": "Procures/buys the specified equipment (contractor, buyer, procurement).",
        "facility_manager": "Runs the facility and drives replacement/upgrade needs.",
        "user": "Uses or maintains equipment but neither specifies nor buys.",
        "irrelevant": "No plausible relationship to such a purchase.",
    },
    "maturity_classes": {
        "enterprise": "Large multi-site operator, major manufacturer, or large EPC/firm.",
        "mid_market": "Established operator/contractor/firm with real project budgets.",
        "small": "Small shop, local contractor, or limited purchasing capacity.",
        "unknown": "Not enough evidence to judge size or structure.",
    },
    "tech_classes": {
        "heavy_industrial": "Heavy/complex industrial or classified environment (high equipment need).",
        "standard_commercial": "Standard commercial/institutional facility.",
        "light": "Light or simple ventilation needs.",
        "unknown": "No usable technology/facility evidence.",
    },
    "pain_themes": {
        "aging_failing_equipment": "Aging or failing fans/heaters/ventilation needing replacement.",
        "airflow_ventilation_problem": "Airflow, exhaust, pressure or ventilation performance problem.",
        "compliance_fire_smoke_hazardous_marine": "Fire/smoke, hazardous-area, or marine compliance pressure.",
        "capacity_expansion": "Capacity, throughput or expansion driving new air-moving equipment.",
        "replacement_retrofit": "Planned replacement, retrofit or upgrade of existing systems.",
        "spec_sizing_help_needed": "Needs help specifying/sizing the right equipment.",
        "lead_time_sourcing_risk": "Lead-time or sourcing risk threatening a project schedule.",
        "corrosive_hazardous_environment": "Corrosive/hazardous environment needing specialized equipment.",
        "none_detected": "No problem Knape solves is evident.",
    },
    "trigger_types": {
        "new_facility_expansion": "New facility, line or location, or expansion.",
        "new_project_rfq_spec": "A new project, RFQ, bid or specification in progress.",
        "equipment_failure_replacement": "Equipment failure or a replacement program.",
        "regulatory_deadline": "Regulatory or compliance deadline.",
        "oem_new_product": "An OEM launching a new product needing components.",
        "contract_award": "A contract award or major project win.",
        "none": "No meaningful buying trigger.",
    },
    "disqualifiers": [
        "A competing air-movement equipment rep, distributor, or a manufacturer that sells direct.",
        "A residential/consumer HVAC business with no industrial or commercial air-moving need.",
        "Academic, research-only, or a body that does not purchase this equipment.",
        "A staffing, recruiting or marketing agency.",
        "An organization with no plausible air-movement, ventilation, heating or dust-control need.",
    ],
    "fit_bands": ["Poor", "Weak", "Good", "Excellent"],
    "strength_bands": ["None", "Weak", "Moderate", "Strong"],
    "proximity_bands": ["None", "Distant", "Involved", "Owns decision"],
}


def load_icp() -> dict[str, Any]:
    """KNAPE_ICP with an optional data/knape_icp.json override shallow-merged in."""
    icp: dict[str, Any] = {}
    for k, v in KNAPE_ICP.items():
        icp[k] = dict(v) if isinstance(v, dict) else (list(v) if isinstance(v, list) else v)
    override = Path(__file__).resolve().parent.parent / "data" / "knape_icp.json"
    try:
        if override.is_file():
            patch = json.loads(override.read_text(encoding="utf-8"))
            if isinstance(patch, dict):
                icp.update(patch)
    except (OSError, ValueError):
        pass
    return icp


def _disq_text(icp: dict[str, Any]) -> str:
    return " ".join(f"({i + 1}) {d}" for i, d in enumerate(icp.get("disqualifiers", [])))


# --- Stage builders -----------------------------------------------------------
def target_filter_questions(icp: dict[str, Any] | None = None) -> dict[str, Any]:
    """Cheap pre-enrichment filter: run this BEFORE spending contact credits."""
    icp = icp or load_icp()
    return {
        "application": choice(
            "Using only the evidence in state, which market/application does this "
            "company operate in?",
            icp["applications"],
        ),
        "is_target": noul(
            "Is this a company Knape Associates could sell industrial air-movement, "
            "ventilation, heating or dust-control equipment or engineering/sourcing "
            f"services to? Exclude: {_disq_text(icp)}"
        ),
    }


def website_icp_questions(icp: dict[str, Any] | None = None) -> dict[str, Any]:
    """Website-to-ICP: application, fit, type, maturity, pain, offer, tech in one call."""
    icp = icp or load_icp()
    return {
        "application": choice(
            "Classify the company's primary market/application from the evidence.",
            icp["applications"],
        ),
        "customer_type": choice(
            "What kind of customer is this to an equipment representative like Knape?",
            icp["customer_types"],
        ),
        "icp_fit": score(
            "How well does this company match Knape's ideal customer: an industrial, "
            "marine, oil & gas, healthcare, power, wastewater or OEM operator, "
            "engineering firm or contractor that specifies, buys or needs air-moving, "
            "ventilation, heating or dust-control equipment?",
            icp["fit_bands"],
        ),
        "maturity": choice("Judge the company's size/structure.", icp["maturity_classes"]),
        "pain_present": noul(
            "Does the evidence show a problem Knape solves (aging/failing ventilation, "
            "airflow/exhaust problem, compliance pressure, capacity/expansion, "
            "replacement/retrofit, or a corrosive/hazardous environment)?"
        ),
        "pain_strength": score("How strong is the evidence of that problem?", icp["strength_bands"]),
        "pain_theme": choice("Which problem theme best fits the evidence?", icp["pain_themes"]),
        "offer_angle": choice(
            "Which single Knape offer family best matches this lead's situation?",
            icp["offer_families"],
        ),
        "tech_class": choice(
            "Classify the company's facility/environment type.", icp["tech_classes"]
        ),
    }


def buyer_questions(icp: dict[str, Any] | None = None) -> dict[str, Any]:
    """Buyer-role routing for one contact (title + company context in state)."""
    icp = icp or load_icp()
    return {
        "buyer_role": choice(
            "Classify this contact's relationship to purchasing industrial air-moving "
            "or ventilation equipment, using the title and company context in state.",
            icp["buyer_roles"],
        ),
        "buyer_proximity": score(
            "How close is this contact to owning or authorizing such a purchase?",
            icp["proximity_bands"],
        ),
    }


def trigger_questions(icp: dict[str, Any] | None = None) -> dict[str, Any]:
    """Trigger interpretation. Jev judges MEANING; code owns date/recency."""
    icp = icp or load_icp()
    return {
        "trigger_present": noul(
            "Does the evidence indicate a meaningful buying trigger (new facility or "
            "expansion, a new project/RFQ/spec, equipment failure or replacement "
            "program, a regulatory deadline, an OEM product launch, or a contract award)?"
        ),
        "trigger_class": choice("Which trigger type does the evidence represent?", icp["trigger_types"]),
    }


def proof_question() -> dict[str, Any]:
    """Evidence verification: put the claim in state.claim, the source in state.evidence."""
    return {
        "evidence_supported": noul(
            "Does the evidence in state actually support the claimed attribute in "
            "state.claim, rather than being unrelated or taken out of context?"
        )
    }


def dedup_question() -> dict[str, Any]:
    """Entity resolution for an ambiguous pair (state.record_a / state.record_b)."""
    return {
        "duplicate_probability": noul(
            "Do state.record_a and state.record_b refer to the same underlying company "
            "(same entity, not merely a similar name)?"
        )
    }


def routing_questions() -> dict[str, Any]:
    """Jev's view of routing. The final decision is made in code from score + confidence."""
    return {
        "outreach_route": choice(
            "Given the qualified state, how should this lead be handled now?",
            {
                "auto_sequence": "Strong, well-evidenced fit: eligible for automated outreach.",
                "human_review": "Promising but a human should confirm before outreach.",
                "enrich_more": "Not enough evidence yet: gather more before deciding.",
                "nurture": "Weak or long-horizon fit: low-priority nurture.",
                "suppress": "Not a fit or disqualified: do not contact for this campaign.",
            },
        ),
    }
