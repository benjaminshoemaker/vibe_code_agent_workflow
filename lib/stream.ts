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

function handleEvent(payload: string, handlers?: StreamEventHandlers) {
  const eventMatch = payload.match(/^event:\s*(.*)$/m);
  const dataMatch = payload.match(/^data:\s*(.*)$/m);
  if (!eventMatch || !dataMatch) return;

  const eventName = eventMatch[1]?.trim();
  const data = dataMatch[1] ?? "";

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
