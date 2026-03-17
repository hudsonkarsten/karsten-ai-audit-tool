const CLAUDE_MODEL = "claude-sonnet-4-20250514";
const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";

function escapeText(s) {
  return String(s ?? "").replace(/\s+/g, " ").trim();
}

function buildPrompt(inputs) {
  return `
You are Karsten AI Agency's business auditor. Generate a concise, high-signal AI audit for the business described below.

Business:
- Name: ${inputs.businessName}
- Industry/type: ${inputs.industry}
- Biggest current problem: ${inputs.problem}
- Team size: ${inputs.teamSize}
- Monthly revenue range: ${inputs.revenueRange}
- Current tools: ${inputs.tools}

Output requirements (STRICT):
- Return ONLY valid JSON. No markdown, no commentary, no code fences.
- Use this exact JSON shape:
{
  "problems_identified": ["..."],
  "recommended_ai_solutions": ["..."],
  "estimated_roi": ["..."],
  "first_3_steps": ["...", "...", "..."],
  "disclaimer": "..."
}

Content constraints:
- Keep each list item to 1–2 sentences max.
- Provide 5–7 problems, 6–10 solutions, 4–6 ROI bullets (include time saved / cost impact ranges when possible without pretending certainty), and exactly 3 steps.
- Make solutions practical: automation ideas, AI agents, retrieval/search, call/email handling, CRM, SOP generation, analytics, etc.
- Avoid vendor lock-in: mention categories (e.g., "CRM", "ticketing", "RPA") rather than only brand names; you can reference their current tools when relevant.
  `.trim();
}

function normalizeReport(parsed) {
  const out = {
    problems_identified: Array.isArray(parsed?.problems_identified) ? parsed.problems_identified : [],
    recommended_ai_solutions: Array.isArray(parsed?.recommended_ai_solutions)
      ? parsed.recommended_ai_solutions
      : [],
    estimated_roi: Array.isArray(parsed?.estimated_roi) ? parsed.estimated_roi : [],
    first_3_steps: Array.isArray(parsed?.first_3_steps) ? parsed.first_3_steps.slice(0, 3) : [],
    disclaimer: typeof parsed?.disclaimer === "string" ? parsed.disclaimer : ""
  };
  if (out.first_3_steps.length > 3) out.first_3_steps = out.first_3_steps.slice(0, 3);
  return out;
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    const apiKey = process.env.CLAUDE_API_KEY;
    if (!apiKey) {
      res.status(500).json({ error: "Server missing CLAUDE_API_KEY env var" });
      return;
    }

    const raw = req.body || {};
    const inputs = {
      businessName: escapeText(raw.businessName),
      industry: escapeText(raw.industry),
      problem: String(raw.problem ?? "").trim(),
      teamSize: escapeText(raw.teamSize),
      revenueRange: escapeText(raw.revenueRange),
      tools: escapeText(raw.tools)
    };

    const missing = Object.entries(inputs)
      .filter(([, v]) => !v)
      .map(([k]) => k);
    if (missing.length) {
      res.status(400).json({ error: "Missing fields: " + missing.join(", ") });
      return;
    }

    const body = {
      model: CLAUDE_MODEL,
      max_tokens: 900,
      temperature: 0.6,
      messages: [{ role: "user", content: buildPrompt(inputs) }]
    };

    const upstream = await fetch(ANTHROPIC_MESSAGES_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify(body)
    });

    const text = await upstream.text();
    if (!upstream.ok) {
      let extra = "";
      try {
        const j = JSON.parse(text);
        extra = j?.error?.message ? ` (${j.error.message})` : "";
      } catch {
        // ignore
      }
      res.status(upstream.status).json({ error: `Anthropic error: ${upstream.status} ${upstream.statusText}${extra}` });
      return;
    }

    // Anthropic response is JSON; model's content[0].text should be a JSON string per our prompt
    let report;
    try {
      const payload = JSON.parse(text);
      const content = payload?.content?.[0]?.text ?? "";
      report = normalizeReport(JSON.parse(content));
    } catch {
      res.status(502).json({ error: "Could not parse model response as JSON" });
      return;
    }

    res.status(200).json(report);
  } catch (err) {
    res.status(500).json({ error: String(err?.message || err || "Unknown server error") });
  }
}

