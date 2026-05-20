import OpenAI from 'openai';
import { zodResponseFormat } from 'openai/helpers/zod';
import { z } from 'zod';
import { getEnv } from './env';

export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
export const DEFAULT_MODEL = 'openai/gpt-5.4-nano';

export function createOpenRouterClient(): OpenAI {
  const env = getEnv();
  return new OpenAI({
    baseURL: OPENROUTER_BASE_URL,
    apiKey: env.OPENROUTER_API_KEY
  });
}

export interface StructuredCompletionOptions<T extends z.ZodType> {
  systemPrompt: string;
  userPrompt: string;
  schema: T;
  schemaName: string;
  model?: string;
}

export async function structuredCompletion<T extends z.ZodType>(
  options: StructuredCompletionOptions<T>
): Promise<z.infer<T>> {
  const client = createOpenRouterClient();
  const completion = await client.chat.completions.parse({
    model: options.model ?? DEFAULT_MODEL,
    messages: [
      { role: 'system', content: options.systemPrompt },
      { role: 'user', content: options.userPrompt }
    ],
    response_format: zodResponseFormat(options.schema, options.schemaName)
  });

  const result = completion.choices[0]?.message?.parsed;
  if (!result) {
    throw new Error('Failed to parse structured output from the model.');
  }

  return result;
}
