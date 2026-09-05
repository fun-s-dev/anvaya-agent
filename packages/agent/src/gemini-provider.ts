import { z } from 'zod';
import { GoogleGenerativeAI } from '@google/generative-ai';

import type { AgentCaseType, LlmProvider } from './index.js';

export type GeminiProviderOptions = {
  apiKey: string;
  modelName?: string;
  timeoutMs?: number;
  generateContentImpl?: (input: { apiKey: string; modelName: string; prompt: string }) => Promise<string>;
};

/**
 * Small server-side Gemini adapter. The API key is intentionally supplied by
 * the caller so this package never reads process.env (or exposes credentials).
 */
export function createGeminiProvider(options: GeminiProviderOptions): LlmProvider {
  const modelName = options.modelName ?? 'gemini-2.0-flash';
  const timeoutMs = options.timeoutMs ?? 10_000;

  if (!options.apiKey.trim()) throw new Error('Gemini API key is required');

  return {
    modelName,
    modelProvider: 'google-gemini',
    async generateStructuredAction<T>(input: {
      caseId: string;
      caseType: AgentCaseType;
      evidence: Record<string, unknown>;
      schema: z.ZodType<T>;
    }): Promise<T> {
      try {
        const prompt = [
          'Return exactly one JSON object describing the next admissible reconciliation investigation action.',
          'The JSON is untrusted model output and will be validated by the controller; never invent evidence IDs.',
          `case_id=${input.caseId}; case_type=${input.caseType}`,
          `MINIMAL_EVIDENCE_JSON=${JSON.stringify(input.evidence)}`,
        ].join('\n');
        const generation = options.generateContentImpl
          ? options.generateContentImpl({ apiKey: options.apiKey, modelName, prompt })
          : generateWithSdk(options.apiKey, modelName, prompt);
        const text = await Promise.race([
          generation,
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Gemini request timed out')), timeoutMs)),
        ]);
        if (!text) throw new Error('Gemini returned no structured content');
        if (text.length > 16_384) throw new Error('Gemini response exceeded the structured output limit');
        let decoded: unknown;
        try {
          decoded = JSON.parse(text);
        } catch {
          throw new Error('Gemini returned invalid JSON');
        }

        return input.schema.parse(decoded);
      } catch (error) {
        throw error instanceof Error ? error : new Error('Gemini provider failed');
      }
    },
  };
}

async function generateWithSdk(apiKey: string, modelName: string, prompt: string): Promise<string> {
  const client = new GoogleGenerativeAI(apiKey);
  const model = client.getGenerativeModel({
    model: modelName,
    generationConfig: { responseMimeType: 'application/json', temperature: 0 },
  });
  const result = await model.generateContent(prompt);
  return result.response.text();
}
