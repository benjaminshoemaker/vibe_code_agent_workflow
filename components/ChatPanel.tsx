"use client";
import "@chatscope/chat-ui-kit-styles/dist/default/styles.min.css";
import { MainContainer, ChatContainer, MessageList, Message, MessageInput } from "@chatscope/chat-ui-kit-react";
import { useCallback, useRef, useState } from "react";

type Role = "user" | "assistant" | "orchestrator";

type ChatItem = {
  id: string;
  role: Role;
  text: string;
};

function RoleBadge({ role }: { role: Role }) {
  const styles: Record<Role, string> = {
    user: "bg-blue-100 text-blue-800",
    assistant: "bg-emerald-100 text-emerald-800",
    orchestrator: "bg-purple-100 text-purple-800"
  };
  const labels: Record<Role, string> = {
    user: "User",
    assistant: "Assistant",
    orchestrator: "Orchestrator"
  };
  return (
    <span className={`ml-2 rounded-full px-2 py-0.5 text-[10px] font-semibold ${styles[role]}`}>{labels[role]}</span>
  );
}

export default function ChatPanel({ stage, className }: { stage: string; className?: string }) {
  const [messages, setMessages] = useState<ChatItem[]>([]);
  const sendingRef = useRef(false);

  const append = useCallback((msg: ChatItem) => {
    setMessages((prev) => [...prev, msg]);
  }, []);

  const onSend = useCallback(
    async (text: string) => {
      if (!text.trim() || sendingRef.current) return;
      sendingRef.current = true;
      append({ id: crypto.randomUUID(), role: "user", text });

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: text, stage })
        });

        // Basic SSE reader for assistant.delta events
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
                append({ id: crypto.randomUUID(), role: "assistant", text: dat });
              }
            }
          }
        }
      } catch {
        append({ id: crypto.randomUUID(), role: "orchestrator", text: "(stream error)" });
      } finally {
        sendingRef.current = false;
      }
    },
    [append, stage]
  );

  return (
    <div className={className}>
      <style jsx global>{`
        /* ChatKit overrides for cleaner design */
        .cs-main-container {
          background: white !important;
          border: 1px solid #e2e8f0 !important;
        }
        .cs-chat-container {
          background: white !important;
        }
        .cs-message-list {
          background: white !important;
        }
        .cs-message-input {
          background: white !important;
          border: none !important;
          border-top: 1px solid #e2e8f0 !important;
          border-radius: 0 !important;
          padding: 1rem !important;
          min-height: 70px !important;
        }
        .cs-message-input__content-editor-wrapper {
          background: #f8fafc !important;
          border: 1px solid #e2e8f0 !important;
          border-radius: 0.75rem !important;
          min-height: 52px !important;
          padding: 0.5rem !important;
        }
        .cs-message-input__content-editor {
          background: #f8fafc !important;
          color: #64748b !important;
          padding: 0.5rem 0.75rem !important;
          min-height: 40px !important;
          font-size: 0.9375rem !important;
        }
        .cs-message-input__content-editor::placeholder {
          color: #94a3b8 !important;
        }
        .cs-message-input__content-editor:focus {
          outline: none !important;
        }
        .cs-message-input__tools {
          padding: 0.25rem 0.5rem !important;
        }
        .cs-button--send {
          background: #475569 !important;
          border-radius: 0.5rem !important;
          padding: 0.5rem 1rem !important;
          min-height: 36px !important;
          font-weight: 600 !important;
        }
        .cs-button--send:hover {
          background: #334155 !important;
        }
        .cs-button--send svg {
          width: 18px !important;
          height: 18px !important;
        }
        .cs-message--incoming .cs-message__content {
          background: #f8fafc !important;
          border: 1px solid #e2e8f0 !important;
        }
        .cs-message--outgoing .cs-message__content {
          background: #3b82f6 !important;
        }
      `}</style>
      <MainContainer style={{ height: "360px", borderRadius: "0.75rem" }}>
        <ChatContainer>
          <MessageList>
            {messages.map((m) => (
              <div key={m.id}>
                <Message
                  model={{
                    direction: m.role === "user" ? "outgoing" : "incoming",
                    message: m.text,
                    sender: m.role,
                    position: "normal"
                  }}
                />
                <div className={`${m.role === "user" ? "text-right" : "text-left"} px-2 mt-1`}>
                  <RoleBadge role={m.role} />
                </div>
              </div>
            ))}
          </MessageList>
          <MessageInput placeholder="Type your message..." onSend={onSend} attachButton={false} sendButton={true} />
        </ChatContainer>
      </MainContainer>
    </div>
  );
}
