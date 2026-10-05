// services/aiCompose.service.ts
//
// Wraps Gemini to draft notification subject+body for the admin panel. The
// admin types a short prompt ("welcome new users", "remind about pending
// invoices") and we return a subject + plain HTML body that matches the
// CashBook brand voice.
//
// Model selection + fallback mirrors controllers/ai.controller.ts. If
// GEMINI_API_KEY isn't configured we throw a clear ApiError so the admin
// panel can show a useful message.

import ApiError from '../Error/handleApiError';

interface GeminiPart { text?: string }
interface GeminiError { error?: { message?: string } }

const SYSTEM_PROMPT = `You write short marketing/notification emails for "CashBook" (a.k.a. HisabBoi), a bookkeeping app for small businesses in Bangladesh.

Constraints:
- Subject: ≤ 60 characters, no emoji, no ALL-CAPS.
- Body: plain HTML fragments only. Use <p>, <strong>, <em>, <a>, <br>. Do NOT use <html>, <head>, <body>, <style>, or scripts.
- Use inline styles sparingly. Prefer semantic HTML. Keep total length under 300 words.
- Voice: friendly, plain Bangla or English depending on the user's prompt. Avoid jargon.
- Never invent prices, dates, or product names. Use {placeholders} like {firstName}, {featureName} for things the admin will fill in.
- If the prompt is unclear, return your best guess and keep it generic.

Output STRICT JSON in this exact shape (no markdown, no prose):
{"subject":"...","body":"<p>...</p>"}`;

export interface AiComposeArgs {
  prompt: string;
  /** Optional hint like "welcome" / "reminder" / "feature" — narrows tone. */
  tone?: string;
  /** Optional existing template id whose body structure should be reused. */
  templateHint?: string;
}

export interface AiComposeResult {
  subject: string;
  body: string;
}

const callGemini = async (apiKey: string, model: string, body: unknown) => {
  return fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
};

export const composeNotification = async ({
  prompt,
  tone,
  templateHint,
}: AiComposeArgs): Promise<AiComposeResult> => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new ApiError(500, 'AI service not configured');

  const model = process.env.GEMINI_MODEL ?? 'gemini-2.5-pro';
  const fallbackModel = process.env.GEMINI_FALLBACK_MODEL ?? 'gemini-2.5-flash';

  const userParts = [
    prompt.trim(),
    tone ? `\nTone: ${tone}` : '',
    templateHint ? `\nUse the structure of the "${templateHint}" template.` : '',
  ]
    .filter(Boolean)
    .join('');

  const payload = {
    contents: [
      { role: 'user', parts: [{ text: SYSTEM_PROMPT }] },
      { role: 'model', parts: [{ text: 'OK.' }] },
      { role: 'user', parts: [{ text: userParts }] },
    ],
    generationConfig: { temperature: 0.7, maxOutputTokens: 600 },
  };

  let res = await callGemini(apiKey, model, payload);

  // 429/503 on the pro model → fall back to flash.
  if (
    !res.ok &&
    (res.status === 429 || res.status === 503) &&
    fallbackModel !== model
  ) {
    res = await callGemini(apiKey, fallbackModel, payload);
  }

  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as GeminiError;
    throw new ApiError(
      502,
      `AI error: ${err?.error?.message ?? res.statusText}`,
    );
  }

  const data = (await res.json()) as {
    candidates?: { content?: { parts?: GeminiPart[] } }[];
  };

  const text =
    data?.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ??
    '';

  const json = extractJson(text);
  if (!json?.subject || !json.body) {
    throw new ApiError(502, 'AI returned no usable result. Try a different prompt.');
  }

  return { subject: json.subject, body: json.body };
};

const extractJson = (text: string): AiComposeResult | null => {
  try {
    const cleaned = text.replace(/```json|```/g, '').trim();
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start === -1 || end === -1) return null;
    const parsed = JSON.parse(cleaned.slice(start, end + 1)) as AiComposeResult;
    if (typeof parsed.subject !== 'string' || typeof parsed.body !== 'string') {
      return null;
    }
    return { subject: parsed.subject, body: parsed.body };
  } catch {
    return null;
  }
};