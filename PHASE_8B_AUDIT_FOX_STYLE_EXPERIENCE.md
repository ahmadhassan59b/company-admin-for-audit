# Phase 8B: Audit Fox Style Experience

## Goal

Transform the current HubSpot audit experience into an Audit Fox-style product flow where the user can:

- see one clear overall audit summary
- click into Contacts, Companies, Deals, Emails, and Workflows
- get an AI analyzer for each section
- focus the bottom of the report on critical findings first
- keep the report understandable for non-technical users

## Core Experience

### Main Audit Page

The main audit page should show:

1. Overall health score
2. Executive summary
3. Clickable object cards
4. AI summary for the whole audit
5. Critical issues at the bottom

### Object Drill-Down

Each object card should open a focused view for:

- Contacts
- Companies
- Deals
- Emails
- Workflows

That object view should include:

- object score
- object-specific issues
- object-specific executive summary
- object-specific AI analyzer
- export actions where relevant

## AI Behavior

### Whole Audit AI

- run once for the full audit
- summarize the portal-level risk posture
- stay cached by audit id and prompt mode

### Object AI

- run only for the selected object
- use the filtered issue list for that object
- cache separately by audit id, object type, and prompt mode
- reuse the same model and token controls

### Optimization Rules

- do not generate object AI for every object on initial page load
- generate object AI only when the user clicks that section or asks for it
- keep the existing AI cache and background queue behavior
- do not break the current whole-audit summary

## Report Structure

### Top of Report

- health score hero
- score label
- executive summary
- top risks
- recommended next steps

### Middle of Report

- object cards
- object-level breakdown
- object-specific AI analyzer

### Bottom of Report

- critical issues first
- then high, medium, low, info
- detailed cards with impact and recommended fix

## Acceptance Criteria

- Main report still works for existing audits
- Clicking an object opens a focused object report state
- AI summary can be generated for the whole audit or a single object
- The report keeps using the current cache and retry logic
- Older reports still render cleanly
- Critical findings remain visible without overwhelming the page

## Suggested Implementation Order

1. Add object-specific AI generation support in the backend
2. Persist object AI separately from whole-audit AI
3. Update the report page to pass the selected object type
4. Show object-specific AI in the hero/modal flow
5. Add dedicated drill-down routes later if needed

