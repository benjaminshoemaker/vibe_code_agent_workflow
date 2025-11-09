type StreamEventHandlers = {
  onAssistantDelta?: (delta: string) => void;
  onDocUpdated?: (docName: string) => void;
  onStageReady?: (stage: string) => void;
  onStageNeedsMore?: (payload: { stage?: string; reason?: string }) => void;
  onReconnect?: (attempt: number, delay: number) => void;
  onError?: (error: Error) => void;
  onComplete?: () => void;
};

type StreamOptions = {
  message: string;
  stage: string;
  signal?: AbortSignal;
  maxRetries?: number;
  handlers?: StreamEventHandlers;
};

const DEFAULT_MAX_RETRIES = 3;
const BASE_DELAY_MS = 500;

export async function streamChat(options: StreamOptions) {
  const { message, stage, signal, maxRetries = DEFAULT_MAX_RETRIES, handlers } = options;
  let attempt = 0;

  while (attempt <= maxRetries) {
    try {
      await runStream({ message, stage, signal, handlers });
      handlers?.onComplete?.();
      return;
    } catch (error) {
      if (signal?.aborted) throw error;

      // Don't retry on 429 (rate limit) - the backend lock needs to be released first
      const status = (error as any)?.status;
      if (status === 429) {
        console.error("Rate limit hit - chat stream is already active or lock not released");
        handlers?.onError?.(error as Error);
        throw error;
      }

      if (attempt === maxRetries) {
        handlers?.onError?.(error as Error);
        throw error;
      }

      const delay = Math.min(BASE_DELAY_MS * 2 ** attempt, 5_000);
      handlers?.onReconnect?.(attempt + 1, delay);
      await wait(delay, signal);
      attempt += 1;
    }
  }
}

async function runStream({
  message,
  stage,
  signal,
  handlers
}: {
  message: string;
  stage: string;
  signal?: AbortSignal;
  handlers?: StreamEventHandlers;
}) {
  const controller = new AbortController();
  const combinedSignal = signal
    ? mergeSignals(signal, controller.signal)
    : controller.signal;

  const response = await fetch("/api/chat", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, stage }),
    signal: combinedSignal
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    const error = new Error(
      `CHAT_STREAM_FAILED(${response.status}): ${errorBody || response.statusText || "Unknown error"}`
    );
    // Add status to error for better handling
    (error as any).status = response.status;
    throw error;
  }

  if (!response.body) {
    throw new Error("STREAM_NOT_SUPPORTED");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    buffer = processBuffer(buffer, handlers);
  }
}

function processBuffer(buffer: string, handlers?: StreamEventHandlers) {
  let remainder = buffer;
  let idx: number;

  while ((idx = remainder.indexOf("\n\n")) !== -1) {
    const raw = remainder.slice(0, idx);
    remainder = remainder.slice(idx + 2);
    handleEvent(raw, handlers);
  }

  return remainder;
}

export function parseSSEPayload(payload: string) {
  const eventMatch = payload.match(/^event:\s*(.*)$/m);
  if (!eventMatch) return undefined;
  const dataMatches = [...payload.matchAll(/^data:\s*(.*)$/gm)];
  if (dataMatches.length === 0) return undefined;
  const eventName = eventMatch[1]?.trim();
  const data = dataMatches.map((match) => match[1] ?? "").join("\n");
  return { eventName, data };
}

function handleEvent(payload: string, handlers?: StreamEventHandlers) {
  const parsed = parseSSEPayload(payload);
  if (!parsed) return;
  const { eventName, data } = parsed;

  switch (eventName) {
    case "assistant.delta": {
      handlers?.onAssistantDelta?.(data);
      break;
    }
    case "doc.updated": {
      handlers?.onDocUpdated?.(data.trim());
      break;
    }
    case "stage.ready": {
      handlers?.onStageReady?.(data.trim());
      break;
    }
    case "stage.needs_more": {
      let parsed: { stage?: string; reason?: string } = {};
      try {
        parsed = JSON.parse(data);
      } catch {
        parsed = { reason: data };
      }
      handlers?.onStageNeedsMore?.(parsed);
      break;
    }
    default:
      break;
  }
}

function wait(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);

    const cleanup = () => {
      clearTimeout(timeoutId);
      signal?.removeEventListener("abort", onAbort);
    };

    const onAbort = () => {
      cleanup();
      reject(new DOMException("Aborted", "AbortError"));
    };

    if (signal) {
      signal.addEventListener("abort", onAbort);
    }
  });
}

function mergeSignals(primary: AbortSignal, secondary: AbortSignal) {
  const controller = new AbortController();

  const onAbort = () => controller.abort();
  primary.addEventListener("abort", onAbort);
  secondary.addEventListener("abort", onAbort);

  if (primary.aborted || secondary.aborted) {
    controller.abort();
  }

  return controller.signal;
}
