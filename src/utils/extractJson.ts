// utils/extractJson.ts
//
// Locate and parse the first JSON object in a free-form text response.
// Tolerant of ```json / ``` fences and trailing prose from the model.

export const extractJson = <T = unknown>(text: string): T | null => {
  try {
    const cleaned = text.replace(/```json|```/g, '').trim();
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start === -1 || end === -1) return null;
    return JSON.parse(cleaned.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
};
