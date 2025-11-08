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
import { useCallback, useMemo, useRef, useState } from "react";

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

export default function ChatPanel({ stage, className }: { stage: string; className?: string }) {
  const [messages, setMessages] = useState<ChatItem[]>([]);
  const [typingRole, setTypingRole] = useState<Role | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const requestInFlightRef = useRef(false);
  const streamingMessageIdRef = useRef<string | null>(null);

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
      if (!trimmed || requestInFlightRef.current) return;
      requestInFlightRef.current = true;
      appendMessage("user", trimmed);
      setIsStreaming(true);
      setTypingRole("assistant");
      streamingMessageIdRef.current = null;

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: trimmed, stage })
        });

        const reader = res.body?.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        if (reader) {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            let idx;
            while ((idx = buffer.indexOf("\n\n")) !== -1) {
              const raw = buffer.slice(0, idx);
              buffer = buffer.slice(idx + 2);
              const eventMatch = raw.match(/^event:\s*(.*)$/m);
              const dataMatch = raw.match(/^data:\s*(.*)$/m);
              if (!eventMatch || !dataMatch) continue;
              const evt = eventMatch[1]?.trim();
              const dat = dataMatch[1] ?? "";
              if (evt === "assistant.delta") {
                appendAssistantDelta(dat);
              }
            }
          }
        }
      } catch {
        appendMessage("orchestrator", "The stream failed. Try again in a few seconds.");
      } finally {
        requestInFlightRef.current = false;
        resetStreamState();
      }
    },
    [appendAssistantDelta, appendMessage, resetStreamState, stage]
  );

  return (
    <div className={`space-y-3 ${className ?? ""}`}>
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-slate-700">Chat assistant</p>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium uppercase tracking-wide text-slate-500">
          Stage: {stageLabel}
        </span>
      </div>
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
