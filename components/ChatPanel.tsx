"use client";
import "@chatscope/chat-ui-kit-styles/dist/default/styles.min.css";
import {
  MainContainer,
  ChatContainer,
  MessageList,
  Message,
  MessageInput,
  TypingIndicator
} from "@chatscope/chat-ui-kit-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { streamChat } from "../lib/stream";

type Role = "user" | "assistant" | "orchestrator";

type ChatItem = {
  id: string;
  role: Role;
  text: string;
  createdAt: number;
};

type RoleMeta = {
  label: string;
  direction: "incoming" | "outgoing";
  badgeClass: string;
  avatarBg: string;
  avatarInitial: string;
};

const roleMeta: Record<Role, RoleMeta> = {
  user: {
    label: "You",
    direction: "outgoing",
    badgeClass: "bg-blue-100 text-blue-800",
    avatarBg: "#bfdbfe",
    avatarInitial: "U"
  },
  assistant: {
    label: "Assistant",
    direction: "incoming",
    badgeClass: "bg-emerald-100 text-emerald-800",
    avatarBg: "#bbf7d0",
    avatarInitial: "A"
  },
  orchestrator: {
    label: "Orchestrator",
    direction: "incoming",
    badgeClass: "bg-purple-100 text-purple-800",
    avatarBg: "#e9d5ff",
    avatarInitial: "O"
  }
};

function RoleBadge({ role }: { role: Role }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${roleMeta[role].badgeClass}`}>
      {roleMeta[role].label}
    </span>
  );
}

function formatTimestamp(value: number) {
  return new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit" }).format(value);
}

type ChatPanelProps = {
  stage: string;
  className?: string;
  onDocUpdated?: (docName: string) => void;
  onStageReady?: (stage: string) => void;
};

export default function ChatPanel({ stage, className, onDocUpdated, onStageReady }: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatItem[]>([]);
  const [typingRole, setTypingRole] = useState<Role | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const requestInFlightRef = useRef(false);
  const streamingMessageIdRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const stageLabel = useMemo(() => stage.replace(/_/g, " " ), [stage]);

  const appendMessage = useCallback((role: Role, text: string) => {
    setMessages((prev) => [...prev, { id: crypto.randomUUID(), role, text, createdAt: Date.now() }]);
  }, []);

  const appendAssistantDelta = useCallback((delta: string) => {
    setMessages((prev) => {
      const messageId = streamingMessageIdRef.current;
      if (messageId) {
        return prev.map((msg) => (msg.id === messageId ? { ...msg, text: msg.text + delta } : msg));
      }
      const newId = crypto.randomUUID();
      streamingMessageIdRef.current = newId;
      return [...prev, { id: newId, role: "assistant", text: delta, createdAt: Date.now() }];
    });
  }, []);

  const resetStreamState = useCallback(() => {
    streamingMessageIdRef.current = null;
    setTypingRole(null);
    setIsStreaming(false);
  }, []);

  const onSend = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;

      if (requestInFlightRef.current) {
        abortRef.current?.abort();
        requestInFlightRef.current = false;
        resetStreamState();
      }

      const controller = new AbortController();
      abortRef.current = controller;

      requestInFlightRef.current = true;
      setNotice(null);
      appendMessage("user", trimmed);
      setIsStreaming(true);
      setTypingRole("assistant");
      streamingMessageIdRef.current = null;

      try {
        await streamChat({
          message: trimmed,
          stage,
          signal: controller.signal,
          handlers: {
            onAssistantDelta: appendAssistantDelta,
            onDocUpdated: (docName) => {
              if (docName && onDocUpdated) {
                onDocUpdated(docName);
              }
            },
            onStageReady: (readyStage) => {
              if (readyStage && onStageReady) {
                onStageReady(readyStage);
              }
            },
            onStageNeedsMore: ({ reason }) => {
              setNotice(reason ? `Stage needs more: ${reason}` : "Stage needs more input from you.");
            },
            onError: () => {
              appendMessage("orchestrator", "The stream failed. Try again in a few seconds.");
            }
          }
        });
      } catch {
        // errors handled via handlers
      } finally {
        requestInFlightRef.current = false;
        resetStreamState();
      }
    },
    [appendAssistantDelta, appendMessage, onDocUpdated, onStageReady, resetStreamState, stage]
  );

  useEffect(() => {
    const handler = (event: Event) => {
      const custom = event as CustomEvent<{
        type: "assistant.delta" | "doc.updated" | "stage.ready" | "stage.needs_more";
        data?: string;
        payload?: { stage?: string; reason?: string };
      }>;
      const detail = custom.detail;
      if (!detail) return;
      switch (detail.type) {
        case "assistant.delta":
          appendAssistantDelta(detail.data ?? "");
          break;
        case "doc.updated":
          if (detail.data && onDocUpdated) {
            onDocUpdated(detail.data);
          }
          break;
        case "stage.ready":
          if (detail.data && onStageReady) {
            onStageReady(detail.data);
          }
          break;
        case "stage.needs_more":
          if (detail.payload?.reason) {
            setNotice(`Stage needs more: ${detail.payload.reason}`);
          } else if (detail.data) {
            setNotice(`Stage needs more: ${detail.data}`);
          }
          break;
        default:
          break;
      }
    };

    window.addEventListener("chat.debug", handler as EventListener);
    return () => window.removeEventListener("chat.debug", handler as EventListener);
  }, [appendAssistantDelta, onDocUpdated, onStageReady]);

  return (
    <div className={`space-y-3 ${className ?? ""}`}>
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-slate-700">Chat assistant</p>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium uppercase tracking-wide text-slate-500">
          Stage: {stageLabel}
        </span>
      </div>
      {notice ? (
        <div
          data-testid="chat-notice"
          className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
        >
          {notice}
        </div>
      ) : null}
      <style jsx global>{`
        .cs-main-container {
          background: white !important;
          border: 1px solid #e2e8f0 !important;
          border-radius: 1rem !important;
        }
        .cs-chat-container {
          background: white !important;
          border-radius: 1rem !important;
        }
        .cs-message-list {
          background: white !important;
          padding: 0.75rem !important;
        }
        .cs-message-input {
          background: white !important;
          border-top: 1px solid #e2e8f0 !important;
          border-radius: 0 0 1rem 1rem !important;
          padding: 1rem !important;
        }
        .cs-message-input__content-editor-wrapper {
          background: #f8fafc !important;
          border: 1px solid #e2e8f0 !important;
          border-radius: 0.9rem !important;
          min-height: 52px !important;
        }
        .cs-message-input__content-editor {
          font-size: 0.95rem !important;
          color: #0f172a !important;
          padding: 0.5rem 0.75rem !important;
        }
        .cs-button--send {
          background: #475569 !important;
          border-radius: 0.5rem !important;
          padding: 0.45rem 1.1rem !important;
          font-weight: 600 !important;
        }
        .cs-button--send:hover {
          background: #334155 !important;
        }
        .cs-message--incoming .cs-message__content {
          background: #f8fafc !important;
          border: 1px solid #e2e8f0 !important;
          color: #0f172a !important;
        }
        .cs-message--outgoing .cs-message__content {
          background: #2563eb !important;
          color: white !important;
        }
      `}</style>
      <MainContainer style={{ height: "390px", borderRadius: "1rem" }}>
        <ChatContainer>
          <MessageList
            data-testid="chat-message-list"
            typingIndicator={
              typingRole ? <TypingIndicator content={`${roleMeta[typingRole].label} is responding…`} /> : undefined
            }
          >
            {messages.map((m) => {
              const meta = roleMeta[m.role];
              return (
                <div key={m.id} className="px-1 py-1">
                  <Message
                    model={{
                      direction: meta.direction,
                      message: m.text,
                      sender: meta.label,
                      sentTime: formatTimestamp(m.createdAt),
                      position: "normal"
                    }}
                    avatarPosition={meta.direction === "outgoing" ? "tr" : "tl"}
                  >
                    <div
                      className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold text-slate-900"
                      style={{ backgroundColor: meta.avatarBg }}
                    >
                      {meta.avatarInitial}
                    </div>
                  </Message>
                  <div className={`${meta.direction === "outgoing" ? "text-right" : "text-left"} mt-1 px-2`}>
                    <RoleBadge role={m.role} />
                  </div>
                </div>
              );
            })}
          </MessageList>
          <MessageInput
            placeholder="Ask the assistant to advance this stage…"
            onSend={onSend}
            attachButton={false}
            sendButton={true}
            disabled={isStreaming}
          />
        </ChatContainer>
      </MainContainer>
    </div>
  );
}
