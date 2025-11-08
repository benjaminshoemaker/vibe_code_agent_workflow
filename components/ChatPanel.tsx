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
  return (
    <span className={`ml-2 rounded-full px-2 py-0.5 text-[10px] font-semibold ${styles[role]}`}>{role}</span>
  );
}

export default function ChatPanel({ stage }: { stage: string }) {
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
    <div className="rounded-xl border border-slate-200 bg-white p-2 shadow-sm">
      <MainContainer style={{ height: "60vh" }}>
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
          <MessageInput placeholder="Type a message" onSend={onSend} attachButton={false} />
        </ChatContainer>
      </MainContainer>
    </div>
  );
}
