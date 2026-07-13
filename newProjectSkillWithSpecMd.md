# New Project Skill With Spec-Driven Development

## Purpose

This reusable meta-prompt and working guide helps humans and coding agents start
new software projects or structure larger initiatives in existing projects.

It is intended for:

- non-programmers who want to build software with an AI assistant,
- technically skilled users who want a disciplined project start,
- agents that need a stable operating frame before writing code.

The guide supports both:

- `Greenfield`: starting a new project from a mostly empty state,
- `Brownfield`: taking over, stabilizing, or extending an existing project.

The process is strongly recommended, but not dogmatic. Deviations are allowed
when they are explicit and justified.

## Default Project Values

Unless there is a documented reason to choose otherwise:

- use clear separation between Domain, Application, Infrastructure, and
  Interface,
- prefer Domain-Driven Design terms for business concepts,
- document non-trivial decisions in ADRs,
- use a central roadmap and progress tracking system,
- write co-located `*.spec.md` files for non-trivial boundaries,
- treat tests and observability as first-class concerns.

## When To Use This Guide

Use this guide when:

- a new software project starts,
- an existing project needs structured onboarding,
- a messy project needs stabilization,
- humans and agents need a shared working basis,
- architecture, planning, decisions, and progress should be documented from the
  beginning.

Do not jump directly into code while the goal, boundaries, and decision space
are still unclear.

## Startup Sequence

1. Clarify whether the effort is `Greenfield` or `Brownfield`.
2. Define the product goal and first useful scope.
3. Clarify operating context, users, risks, and constraints.
4. Set architecture and decision defaults.
5. Create the documentation skeleton.
6. Make risks and open questions visible.
7. Only then scaffold or change code.

## Initial Questions

Before the first real architecture or implementation step, clarify:

- What should the product or system do?
- Who uses it?
- What is explicitly out of scope?
- Is this internal tooling, a customer-facing product, or something in between?
- Which legal, security, operational, or organizational constraints exist?
- What must work manually, and what may run autonomously?
- Is the project Greenfield or Brownfield?
- Which existing systems, data sources, or dependencies exist?
- Who decides product, architecture, and operations?
- How are durable decisions documented?
- How is progress tracked?
- Which quality gate is expected?

For Brownfield projects, additionally clarify:

- Which parts must not be changed initially?
- Which documentation exists, and how reliable is it?
- Which build, test, and runtime paths work today?
- Which production or data risks must be protected immediately?

## Architecture Defaults

Unless explicitly decided otherwise:

- `Domain` contains rules, invariants, entities, value objects, and domain
  services.
- `Application` contains use cases and orchestration.
- `Ports` define inbound and outbound boundaries.
- `Adapters` implement transport, persistence, external APIs, and UI-specific
  integration.
- UI, controllers, and database adapters are not places for business logic.

Start from the domain language:

1. name the main business concepts,
2. identify invariants and lifecycle states,
3. derive use cases,
4. define ports and adapters from those use cases.

## Spec-Driven Development

Non-trivial boundaries, use cases, interfaces, and adapters should have
co-located `*.spec.md` files. A spec is the local source of truth for the
boundary it describes.

A useful spec states:

- purpose,
- scope and non-scope,
- inputs and outputs,
- responsibilities,
- invariants,
- failure modes,
- dependencies,
- acceptance criteria,
- tests and verification.

Agents must read relevant specs before changing a non-trivial boundary and must
update the spec in the same change when behavior, contracts, inputs, outputs,
guardrails, or checks materially change.

## ADR Guidance

Create an ADR for durable decisions such as:

- architecture style,
- persistence model,
- authentication model,
- deployment model,
- external service integration,
- important operational or security tradeoffs.

Each ADR should include at least:

- context,
- decision,
- alternatives considered,
- consequences,
- status.

## Recommended Project Skeleton

For a new project, create or adapt:

- `AGENTS.md` for agent operating rules,
- `README.md` for product and setup overview,
- `docs/roadmap/MASTER_PLAN.md`,
- `docs/progress/CURRENT_STATUS.md`,
- `docs/progress/NEXT_STEPS.md`,
- `docs/progress/CHANGELOG_INTERNAL.md`,
- `docs/architecture/SYSTEM_OVERVIEW.md`,
- `docs/decisions/ADR-001-...md`,
- co-located `*.spec.md` files for non-trivial boundaries,
- a single build and check command.

## Agent Operating Rules

When this guide is used as instructions for an assistant, the assistant should:

- clarify Greenfield vs. Brownfield first,
- establish project structure before large implementation work,
- document decisions and progress as work changes the project state,
- prefer small, verifiable steps,
- avoid inventing facts about the current project,
- inspect existing code and docs before changing them,
- surface risks and tradeoffs clearly,
- keep business logic out of UI, controllers, and persistence adapters unless
  the local architecture explicitly allows otherwise.

## Definition Of A Clean Project Start

A project is ready for sustained implementation when these items exist:

1. product goal and initial scope,
2. explicit non-goals,
3. architecture defaults,
4. central roadmap,
5. current status document,
6. next steps document,
7. ADR location and first decision records,
8. co-located specs for non-trivial boundaries,
9. known build and check path,
10. documented risks and open questions.

If these are missing, the project is not yet cleanly initialized.
