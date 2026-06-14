# HubSpot Audit Tool - Phase 3 (AI Integration with OpenAI)

## Overview

This phase adds an AI-powered analysis layer using the OpenAI API to transform raw audit data into actionable insights.

Goal:

- Convert structured audit data into human-readable insights
- Generate recommendations like a HubSpot consultant
- Keep output structured (JSON) for frontend + reports

---

## Architecture (Phase 3)

```text
HubSpot Data
    ↓
Snapshot (existing)
    ↓
Rule Engine (existing)
    ↓
AI Analysis Layer (NEW)
    ↓
Report Builder (NEW)
    ↓
Frontend / API
```

---

## 1. Install Dependencies

```bash
npm install openai zod
```

---

## 2. Environment Variables

```env
OPENAI_API_KEY=your_api_key_here
```

Important:

- ChatGPT login != API key
- Create API key from OpenAI platform

---

## 3. AI Output Schema (STRICT)

File: `src/ai/schema.ts`

```ts
import { z } from "zod";

export const AIResultSchema = z.object({
  summary: z.string(),
  quick_wins: z.array(z.string()),
  strategic_recommendations: z.array(z.string()),
  risk_level: z.enum(["low", "medium", "high"])
});

export type AIResult = z.infer<typeof AIResultSchema>;
```

---

## 4. Prompt Builder

File: `src/ai/prompt.ts`

```ts
export function buildAuditPrompt(snapshot: any, issues: string[]) {
  return `
You are a senior HubSpot CRM audit consultant.

Analyze the following data:

SNAPSHOT:
${JSON.stringify(snapshot, null, 2)}

ISSUES:
${issues.join("\n")}

Tasks:
1. Explain problems clearly
2. Suggest quick wins (fast fixes)
3. Suggest strategic improvements
4. Assign a risk level

Rules:
- Be specific (no generic advice)
- Focus on business impact
- Keep output concise
- No markdown or explanation outside JSON

Return ONLY valid JSON:

{
  "summary": "...",
  "quick_wins": ["..."],
  "strategic_recommendations": ["..."],
  "risk_level": "low | medium | high"
}
`;
}
```

---

## 5. OpenAI Integration

File: `src/ai/openai.ts`

```ts
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

export async function analyzeWithOpenAI(prompt: string) {
  const response = await client.chat.completions.create({
    model: "gpt-4.1",
    temperature: 0.3,
    messages: [
      {
        role: "system",
        content: "You must return only valid JSON. No explanations."
      },
      {
        role: "user",
        content: prompt
      }
    ]
  });

  return response.choices[0].message.content || "";
}
```

---

## 6. Safe JSON Parsing + Validation

File: `src/ai/index.ts`

```ts
import { AIResultSchema } from "./schema";
import { buildAuditPrompt } from "./prompt";
import { analyzeWithOpenAI } from "./openai";

function safeParseJSON(raw: string) {
  try {
    return JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Invalid JSON from AI");
    return JSON.parse(match[0]);
  }
}

export async function analyzeAudit(snapshot: any, issues: string[]) {
  const prompt = buildAuditPrompt(snapshot, issues);

  const raw = await analyzeWithOpenAI(prompt);

  const parsed = safeParseJSON(raw);
  const validated = AIResultSchema.parse(parsed);

  return validated;
}
```

---

## 7. Integrate into Audit Pipeline

File: `src/services/auditService.ts`

```ts
import { analyzeAudit } from "../ai";

export async function runFullAudit(snapshot: any, ruleResults: any) {
  const issues = ruleResults.issues;

  const ai = await analyzeAudit(snapshot, issues);

  return {
    score: ruleResults.score,
    issues,
    summary: ai.summary,
    quick_wins: ai.quick_wins,
    strategic_recommendations: ai.strategic_recommendations,
    risk_level: ai.risk_level
  };
}
```

---

## 8. API Endpoint

Example: `/api/audit/run`

```ts
export default async function handler(req, res) {
  const snapshot = await getSnapshot(req.body.accountId);
  const ruleResults = runRules(snapshot);

  const report = await runFullAudit(snapshot, ruleResults);

  await saveAudit(report);

  res.json(report);
}
```

---

## 9. Performance & Cost Optimization

Model choice:

- `gpt-4.1` -> best quality
- `gpt-4.1-nano` -> cheaper option

Settings:

```ts
temperature: 0.2–0.3
```

Add later:

- Retry logic (if API fails)
- Timeout handling
- Response caching
- Logging AI output

---

## 10. Output Example

```json
{
  "summary": "Your HubSpot setup shows underutilized workflows...",
  "quick_wins": [
    "Activate 3 inactive workflows",
    "Remove unused forms"
  ],
  "strategic_recommendations": [
    "Redesign pipeline stages for better conversion tracking"
  ],
  "risk_level": "medium"
}
```

---

## 11. What This Enables

After this phase:

- You are no longer just showing data
- You are delivering consulting insights automatically

---

## 12. Next Phase (Recommended)

- PDF report generation
- UI redesign (consulting-style)
- Waste calculator ($ impact)
- Audit history comparison

---

## Summary

You now have:

- OpenAI-powered analysis
- Structured AI output (validated)
- Fully integrated audit pipeline

