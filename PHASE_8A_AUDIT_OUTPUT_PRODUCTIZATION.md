# Phase 8A: Audit Output Productization - Audit Fox Style

## Goal

Transform the current HubSpot Audit Tool from a technically strong audit engine into a productized audit experience similar to Audit Fox.

This phase focuses on how audit results are scored, structured, prioritized, and displayed.

## Current App Status

The app already has:

- HubSpot OAuth connection
- token refresh and retry safety
- multi-tenant audit storage
- HubSpot data fetching
- snapshot normalization
- rule-based audit engine
- AI analysis
- cached AI output
- background AI jobs
- dashboard and report UI
- monitoring and security features

This phase must not rebuild the backend.

## What This Phase Adds

### 8A.1 Standardize Audit Output Schema

Each issue should follow one consistent schema so the frontend and AI layer can consume it without module-specific handling.

Required fields:

- `id`
- `objectType`
- `category`
- `title`
- `description`
- `impact`
- `recommendation`
- `riskLevel`
- `severityScore`
- `affectedCount`
- `sampleRecords`
- `source`

### 8A.2 Build Health Score Engine

Add a 0-100 health score with labels:

- 90-100 = Excellent
- 75-89 = Healthy
- 60-74 = Needs Attention
- 40-59 = At Risk
- 0-39 = Critical

Risk penalties:

- critical = 15 points
- high = 8 points
- medium = 4 points
- low = 1 point
- info = 0 points

Use caps so one category cannot destroy the entire score unfairly.

### 8A.3 Add Object-Level Breakdown

Show audit results grouped by HubSpot object/module.

The UI should show cards for:

- Contacts
- Companies
- Deals
- Workflows
- Forms
- Emails
- Properties
- Pipelines

Each card should show:

- object score
- issue count
- highest risk level
- quick summary
- View Issues action

Clicking a card should filter the issue list for that object.

## Acceptance Criteria

- All rule outputs follow the same structure.
- A health score is available for every audit.
- The score is stored with the audit result.
- The score appears on the dashboard and report page.
- Object-level breakdown cards are visible on the report page.
- Clicking an object card filters issues for that object.

## What Has Been Started

- Backend issue output is being standardized.
- A new health score layer has been added.
- Object-level breakdown data is being added to audit results.
- The report page is being updated to render object cards and issue filters.

## Notes

- This phase should keep the existing HubSpot fetch pipeline intact.
- Older reports should still render safely using fallback data.
- The new productized fields should sit on top of the existing score and report data, not replace the whole audit flow.
