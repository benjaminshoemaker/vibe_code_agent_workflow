import OpenAI from "openai";
import type { Responses } from "openai/resources/responses";
import { env } from "../env";

const DEFAULT_MODEL = "gpt-4o-mini";
const GENERATION_TEMPERATURE = 0.2;
const VALIDATION_TEMPERATURE = 0.0;
const REQUEST_TIMEOUT_MS = 20_000;

type ResponseInput = Parameters<Responses["create"]>[0]["input"];

const model = env.OPENAI_MODEL ?? DEFAULT_MODEL;
const apiKey = env.OPENAI_API_KEY;

if (!apiKey) {
  throw new Error("OPENAI_API_KEY is required to call OpenAI APIs.");
}

const client = new OpenAI({
  apiKey,
  baseURL: env.OPENAI_API_BASE
});

export type OpenAIResponseOptions = {
  input: ResponseInput;
  abortSignal?: AbortSignal;
};

export async function generateResponse(options: OpenAIResponseOptions) {
  return callResponsesApi({ ...options, temperature: GENERATION_TEMPERATURE });
}

export async function validateResponse(options: OpenAIResponseOptions) {
  return callResponsesApi({ ...options, temperature: VALIDATION_TEMPERATURE });
}

export function createAbortController() {
  return new AbortController();
}

async function callResponsesApi({
  input,
  abortSignal,
  temperature
}: OpenAIResponseOptions & { temperature: number }) {
  return client.responses.create(
    {
      model,
      temperature,
      input,
      stream: false
    },
    {
      signal: abortSignal,
      timeout: REQUEST_TIMEOUT_MS
    }
  );
}
