# Knape Associates: Buyer Personas

## About this document

This document describes the people who buy from or specify equipment through Knape
Associates. It is the companion to [business-profile.md](./business-profile.md), and
it is kept in lockstep with the lead-generation rubric at
`apps/leadgen/outreach/jev_questions.py` (`KNAPE_ICP`). Each persona lists the exact
rubric keys it maps to, so the sales understanding and the automated classification
never drift apart.

As with the profile, the facts come from Knape's public material. The "cares about,"
"angle" and "trigger" lines are informed interpretations of how these roles behave in
industrial buying, and should be treated as **inferred** working assumptions to
validate against real campaign results, not as statements Knape has published.

## How Knape's buying works

A purchase of industrial air-moving equipment usually involves several people, not
one. An engineer specifies the requirement, a contractor or procurement team sources
it, a facility manager lives with the result, and an owner or procurement head
controls the budget. One generic "products" message does not speak to all of them, so
the personas below separate who specifies, who buys and who owns the decision. In the
rubric this is the difference between `decision_maker`, `engineer_specifier`,
`contractor_procurer`, `facility_manager` and `user` in `KNAPE_ICP["buyer_roles"]`.

A critical note that sits above all personas: a company that is one of Knape's
represented manufacturers is a partner, not a prospect, and a competing air-movement
equipment maker is a competitor. Neither is a buyer persona. The personas here are all
people on the customer and specifier side of the chain.

## Persona template

Each persona uses the same structure: who they are, where they sit, what they care
about, what Knape sells them and the message angle, the trigger that puts them
in-market, where they are found, and the rubric mapping.

---

## 1. Plant or facility engineer

- **Who they are.** An in-house engineer at an operating facility: a plant engineer,
  process engineer, or maintenance engineering lead.
- **Where they sit.** An operating company in industrial manufacturing, oil and gas,
  power, wastewater or a similar vertical.
- **What they care about.** Airflow, static pressure, temperature, materials,
  certifications, reliability and that the equipment solves a real operating problem.
- **What Knape sells them, and the angle.** The right equipment for a specific
  operating problem, plus the engineering help to size and select it. Angle: "tell us
  the application and we will specify the correct equipment."
- **Trigger.** An airflow or ventilation problem, an equipment failure, a capacity
  increase, or a compliance requirement.
- **Where they are found.** Company sites, trade shows, industry directories, and
  LinkedIn under plant and process engineering titles.
- **Rubric mapping.** buyer_role `engineer_specifier`; customer_type
  `facility_plant_operator`; applications per vertical; offer_families across fans,
  dampers, heaters, dust collection and engineering_sourcing.

## 2. MEP or process engineering firm

- **Who they are.** A mechanical, electrical and plumbing or process engineering firm
  that designs facilities and specifies equipment for them.
- **Where they sit.** An engineering or design firm serving industrial, healthcare,
  power, marine and commercial projects.
- **What they care about.** Meeting the project specification, correct sizing,
  certifications, CAD and Revit support, and technical documentation.
- **What Knape sells them, and the angle.** Specification and selection support, and
  equipment that meets the spec. Angle: "we help you specify, and we have the
  manufacturer network to match any requirement."
- **Trigger.** A new project, a bid or an RFQ, or a design in progress.
- **Where they are found.** Engineering-firm directories, project announcements, trade
  shows, and LinkedIn under engineering and design titles.
- **Rubric mapping.** buyer_role `engineer_specifier`; customer_type
  `engineering_mep_firm`; offer_families emphasizing engineering_sourcing.

## 3. Mechanical contractor

- **Who they are.** A mechanical or HVAC contractor that installs systems and procures
  the equipment for them.
- **Where they sit.** A contracting firm working industrial and commercial projects.
- **What they care about.** Price, availability, lead time, submittals, delivery and
  smooth installation.
- **What Knape sells them, and the angle.** The specified equipment, sourced and
  delivered on schedule with submittals handled. Angle: "we get the right equipment to
  your project on time, with the paperwork done."
- **Trigger.** A project award, a bid, or a replacement job.
- **Where they are found.** Contractor directories, project awards, trade shows, and
  LinkedIn under contracting and procurement titles.
- **Rubric mapping.** buyer_role `contractor_procurer`; customer_type
  `mechanical_contractor`.

## 4. General contractor

- **Who they are.** A general or construction contractor responsible for procuring the
  equipment an engineer specified for a build.
- **Where they sit.** A construction firm delivering industrial, commercial or
  multifamily projects.
- **What they care about.** Procuring the specified equipment on budget and on
  schedule, with reliable delivery.
- **What Knape sells them, and the angle.** Reliable sourcing of specified equipment
  for the build. Angle: "hand us the spec and we will source and deliver it."
- **Trigger.** A project award or a construction schedule with ventilation scope.
- **Where they are found.** Construction project announcements, GC directories and
  LinkedIn.
- **Rubric mapping.** buyer_role `contractor_procurer`; customer_type
  `general_contractor`.

## 5. Procurement and purchasing

- **Who they are.** A procurement or purchasing function sourcing the equipment a
  project specified.
- **Where they sit.** The procurement team of an operator, contractor or OEM.
- **What they care about.** Competitive pricing, supplier reliability, availability,
  delivery and clean purchase orders.
- **What Knape sells them, and the angle.** Competitive pricing, availability and
  reliable delivery across multiple manufacturers. Angle: "one source, multiple
  manufacturers, dependable lead times."
- **Trigger.** A requisition, a project budget release, or a replacement program.
- **Where they are found.** Company procurement pages and LinkedIn under purchasing
  and procurement titles.
- **Rubric mapping.** buyer_role `contractor_procurer` (or `decision_maker` for a
  procurement head); customer_type `procurement_team`.

## 6. Facility manager

- **Who they are.** The person who runs a building or plant and owns its upkeep.
- **Where they sit.** An operating facility across any served vertical.
- **What they care about.** Reliability, maintenance, replacement, energy use and
  avoiding downtime.
- **What Knape sells them, and the angle.** Replacement and upgrade equipment, and the
  free equipment audit. Angle: "we will assess your existing system at no cost and
  recommend the right replacement."
- **Trigger.** Aging or failing equipment, a reliability problem, or an upgrade cycle.
- **Where they are found.** Facility and operations directories, property operators and
  LinkedIn under facility and operations titles.
- **Rubric mapping.** buyer_role `facility_manager`; customer_type
  `facility_plant_operator`; offer_families often replacement-oriented plus
  engineering_sourcing (the audit).

## 7. OEM or machine builder

- **Who they are.** A company that designs and builds machines or products that need an
  air-moving component.
- **Where they sit.** An original equipment manufacturer in industrial or process
  equipment.
- **What they care about.** Exact fit, repeatability, engineering support, custom
  configuration and continuity of supply.
- **What Knape sells them, and the angle.** The exact component, matched or modified to
  the machine, working with their design and procurement teams. Angle: "we match or
  modify the right component to your machine and keep it supplied."
- **Trigger.** A new product launch, a redesign, or a supply problem with a current
  component.
- **Where they are found.** OEM and machine-builder directories, product launches and
  LinkedIn under design and procurement titles.
- **Rubric mapping.** buyer_role `decision_maker` or `engineer_specifier` depending on
  contact; customer_type `oem_builder`; application `oem`.

## 8. Marine engineering

- **Who they are.** A marine engineering company, shipyard or offshore operator.
- **Where they sit.** Marine and offshore: ships, shipyards, platforms and vessels.
- **What they care about.** Marine certifications, corrosion resistance, fire
  requirements, space constraints and reliability at sea.
- **What Knape sells them, and the angle.** Marine-rated and explosion-proof
  ventilation equipment that meets marine requirements. Angle: "compliant,
  marine-rated air movement for demanding vessel and offshore environments."
- **Trigger.** A new build, a refit, or a replacement on a vessel or platform.
- **Where they are found.** Marine and shipyard directories, offshore operators and
  marine trade shows.
- **Rubric mapping.** buyer_role `engineer_specifier` or `contractor_procurer`;
  application `marine_offshore`; offer_families emphasizing specialty_equipment.

## 9. Oil and gas

- **Who they are.** An energy company or its engineering and procurement teams working
  classified and hazardous environments.
- **Where they sit.** Oil, gas, petrochemical, refining and LNG.
- **What they care about.** Equipment that works in hazardous and classified areas,
  explosion protection, and lead times that do not threaten the project schedule.
- **What Knape sells them, and the angle.** Explosion-proof and classified-area
  equipment, with sourcing flexibility across manufacturers to protect the schedule.
  Angle: "compliant equipment for classified environments, sourced to beat
  manufacturer backlogs."
- **Trigger.** A new facility or expansion, a turnaround, or a regulatory deadline.
- **Where they are found.** Energy-company sites, oil and gas project announcements and
  industry trade shows.
- **Rubric mapping.** buyer_role `engineer_specifier` or `decision_maker`; application
  `oil_gas`; pain themes around compliance and hazardous environments.

## 10. Architect or MEP specifier

- **Who they are.** An architect or MEP engineer who writes the specification that a
  project must meet.
- **Where they sit.** A design practice on commercial, institutional and multifamily
  projects.
- **What they care about.** That the equipment meets the written project
  specification, certifications and documentation.
- **What Knape sells them, and the angle.** Equipment that meets the specification, with
  the technical documentation to prove it. Angle: "we supply exactly to your
  specification, with the submittals to match."
- **Trigger.** A design in progress or a specification being written.
- **Where they are found.** Architecture and MEP firm directories and LinkedIn.
- **Rubric mapping.** buyer_role `engineer_specifier`; customer_type
  `engineering_mep_firm`.

## Using these personas

For lead generation, the personas tell the Jev rubric which contacts to prioritize
and how to route them. A contact who matches `decision_maker` or a strong
`engineer_specifier` at a target operator, engineering firm, contractor or OEM is a
high-priority lead. A `user` with no buying or specifying influence is lower priority.
A contact at a partner manufacturer or a competitor is not a lead at all.

For outreach copy (a later stage), the "angle" line for each persona is the starting
point for the message, and the "trigger" line is what makes the outreach timely.
