// utils/gemini.ts
//
// Shared wrapper for Gemini API calls. The 429/503 → fallback-model retry is
// applied uniformly across every AI call site (planner, composer, chat).

export interface GeminiError { error?: { message?: string } }

export const callGemini = async (
  apiKey: string,
  model: string,
  body: unknown,
): Promise<Response> => {
  return fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
};

export const callGeminiWithFallback = async (
  apiKey: string,
  primaryModel: string,
  fallbackModel: string,
  body: unknown,
): Promise<Response> => {
  const res = await callGemini(apiKey, primaryModel, body);
  if (
    !res.ok &&
    (res.status === 429 || res.status === 503) &&
    fallbackModel !== primaryModel
  ) {
    return callGemini(apiKey, fallbackModel, body);
  }
  return res;
};

export const extractGeminiError = async (
  res: Response,
): Promise<string> => {
  const err = (await res.json().catch(() => ({}))) as GeminiError;
  return err?.error?.message ?? res.statusText;
};
