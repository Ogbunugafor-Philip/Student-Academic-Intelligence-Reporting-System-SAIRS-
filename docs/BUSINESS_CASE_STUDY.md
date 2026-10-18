# SAIRS Business Analysis & Digital Transformation Case Study

[← README](../README.md) · [Workflows](BUSINESS_WORKFLOWS.md) · [Features](FEATURES.md)

## Context and problem framing

SAIRS addresses an information chain that begins with school configuration and enrolment and ends with an approved academic record delivered to a family. The central analysis challenge is not calculation alone: different stakeholders act at different stages, the same student changes class over time, and published evidence must remain trustworthy after operational data changes.

## Stakeholders and needs

| Stakeholder | Core need represented in the implementation |
|---|---|
| IT Administrator | Configure the academic environment and govern identities/data quality |
| Subject Teacher | Work only within assigned subjects/classes and save progressive assessment |
| Form Teacher | Know whether a class is complete and compile a coherent cohort |
| Management | Review evidence, return exceptions and control publication |
| Parent/Guardian | Privately access linked children and authentic published records |
| Student | Benefit from an accurate, durable record (no direct login role) |

## Requirements translated into design

- **Current context and history:** session enrolments separate historical placement from the mutable student profile.
- **Segregation of duties:** assignment and role checks distinguish capture, compilation and publication.
- **Data quality:** maxima, period relationships, grading coverage and completeness rules fail early.
- **Traceability:** status histories and audit records preserve actor, action and context.
- **Publication integrity:** snapshots, versions, checksums and verification tokens preserve issued evidence.
- **Operational resilience:** transactional imports and encrypted offline queues reduce partial work.

## Process redesign

The solution replaces an implicit hand-off with visible states: draft score → submitted component → management decision → complete class compilation → management approval → published report. Automation calculates and checks; people retain responsibility for academic entry and approval. Exceptions return to the correct actor instead of bypassing the workflow.

## Decision support

School-wide and scoped performance views use published evidence. The system derives direction, failure patterns, declines and sudden drops, then associates non-diagnostic support recommendations. These signals support discussion; they do not modify grades or claim causation.

## Portfolio evidence

The project demonstrates requirements elicitation from a complex domain, stakeholder/permission mapping, relational and historical modelling, business-rule implementation, workflow automation, full-stack delivery, reporting, offline design, security controls and extensive automated verification. No unverified claims are made about adoption, savings, uptime, attainment or commercial deployment.
