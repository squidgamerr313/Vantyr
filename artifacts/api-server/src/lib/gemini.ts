import { GoogleGenAI } from "@google/genai";

/** Same managed client configuration as the Replit Gemini integration template. */
export function getGemini() {
  const apiKey = process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
  const baseUrl = process.env.AI_INTEGRATIONS_GEMINI_BASE_URL;
  if (!apiKey || !baseUrl) throw new Error("Gemini integration is not configured");
  return new GoogleGenAI({
    apiKey,
    httpOptions: { apiVersion: "", baseUrl, timeout: 45000 },
  });
}
