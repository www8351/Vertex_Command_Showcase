import { useState, useRef, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import { getCsrfToken } from "@/lib/queryClient";
import { isRTL } from "@/i18n";
import { MessageCircle, X, Send, Loader2, Bot, Crown } from "lucide-react";
import { apiUrl } from "@/lib/apiBase";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  isPlanLimit?: boolean;
}

export default function FloatingHelpChat() {
  const { t, i18n } = useTranslation();
  const [, navigate] = useLocation();
  const dir = isRTL(i18n.language) ? "rtl" : "ltr";
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (isOpen) setTimeout(() => inputRef.current?.focus(), 200);
  }, [isOpen]);

  const sendMessage = useCallback(async () => {
    if (!input.trim() || isLoading) return;

    const userMessage = input.trim();
    setInput("");
    setMessages(prev => [...prev, { role: "user", content: userMessage }]);
    setIsLoading(true);

    try {
      const csrfToken = await getCsrfToken();
      const chatHeaders: Record<string, string> = { "Content-Type": "application/json" };
      if (csrfToken) chatHeaders["x-csrf-token"] = csrfToken;
      const response = await fetch(apiUrl("/api/v1/help/chat"), {
        method: "POST",
        headers: chatHeaders,
        credentials: "include",
        body: JSON.stringify({
          message: userMessage,
          history: messages.slice(-10),
        }),
      });

      if (!response.ok) {
        if (response.status === 403) {
          try {
            const err = await response.json();
            if (err.code === 'plan_limit') {
              setMessages(prev => [...prev, { role: "assistant", content: t('planLimit.features.ai_chatbot'), isPlanLimit: true }]);
              setIsLoading(false);
              return;
            }
          } catch {}
        }
        throw new Error("Failed");
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No reader");

      const decoder = new TextDecoder();
      let buffer = "";
      let assistantContent = "";

      setMessages(prev => [...prev, { role: "assistant", content: "" }]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const event = JSON.parse(line.slice(6));
            if (event.content) {
              assistantContent += event.content;
              setMessages(prev => {
                const updated = [...prev];
                updated[updated.length - 1] = { role: "assistant", content: assistantContent };
                return updated;
              });
            }
          } catch {}
        }
      }
    } catch {
      setMessages(prev => [...prev, { role: "assistant", content: t('help.chatError') }]);
    } finally {
      setIsLoading(false);
    }
  }, [input, isLoading, messages, t]);

  return (
    <>
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className={`fixed bottom-6 ${dir === 'rtl' ? 'left-6' : 'right-6'} z-50 w-14 h-14 rounded-full bg-indigo-600 hover:bg-indigo-700 text-white shadow-lg shadow-indigo-600/30 flex items-center justify-center transition-all hover:scale-105 active:scale-95`}
          data-testid="button-floating-help"
        >
          <MessageCircle className="w-6 h-6" />
        </button>
      )}

      {isOpen && (
        <div
          className={`fixed bottom-6 ${dir === 'rtl' ? 'left-6' : 'right-6'} z-50 w-[360px] max-w-[calc(100vw-3rem)] h-[500px] max-h-[calc(100vh-6rem)] bg-card border border-border rounded-2xl shadow-2xl flex flex-col overflow-hidden`}
          style={{ direction: dir }}
          data-testid="floating-help-chat"
        >
          <div className="h-14 flex items-center justify-between px-4 border-b border-border bg-indigo-600 rounded-t-2xl">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center">
                <Bot className="w-4.5 h-4.5 text-white" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-white">{t('help.botName')}</h3>
                <p className="text-[10px] text-indigo-200">{t('help.botOnline')}</p>
              </div>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              className="w-8 h-8 rounded-full hover:bg-white/10 flex items-center justify-center text-white/80 hover:text-white transition-colors"
              data-testid="button-close-help-chat"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex-1 overflow-auto p-4 space-y-3">
            {messages.length === 0 && (
              <div className="text-center py-8">
                <Bot className="w-10 h-10 text-indigo-500 mx-auto mb-3" />
                <p className="text-sm font-medium text-foreground mb-1">{t('help.botGreeting')}</p>
                <p className="text-xs text-muted-foreground mb-4">{t('help.botHint')}</p>
                <div className="space-y-1.5">
                  {[t('help.faq.q5'), t('help.faq.q3')].filter(Boolean).map((q, i) => (
                    <button
                      key={i}
                      onClick={() => { setInput(q); setTimeout(() => inputRef.current?.focus(), 50); }}
                      className="w-full text-start text-xs p-2.5 bg-secondary/50 border border-border rounded-lg hover:bg-secondary hover:border-indigo-500/30 transition-colors text-muted-foreground hover:text-foreground"
                      data-testid={`floating-suggestion-${i}`}
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg, index) => (
              <div
                key={index}
                className={`flex ${msg.role === "user" ? (dir === 'rtl' ? "justify-start" : "justify-end") : (dir === 'rtl' ? "justify-end" : "justify-start")}`}
                data-testid={`floating-msg-${index}`}
              >
                <div className={`max-w-[85%] rounded-xl px-3.5 py-2 text-sm leading-relaxed whitespace-pre-line ${
                  msg.role === "user"
                    ? "bg-indigo-600 text-white"
                    : "bg-secondary border border-border text-foreground"
                }`}>
                  {msg.role === "assistant" && !msg.content && (
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span className="text-xs">{t('help.thinking')}</span>
                    </div>
                  )}
                  {msg.content}
                  {msg.isPlanLimit && (
                    <button
                      onClick={() => { setIsOpen(false); navigate('/billing'); }}
                      className="mt-2 flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-medium transition-colors"
                      data-testid="button-chat-upgrade-plan"
                    >
                      <Crown className="w-3.5 h-3.5" />
                      {t('planLimit.upgrade')}
                    </button>
                  )}
                </div>
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>

          <div className="border-t border-border p-3">
            <div className="flex gap-2">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                placeholder={t('help.chatInputPlaceholder')}
                className="flex-1 bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/50 transition-all placeholder:text-muted-foreground"
                disabled={isLoading}
                data-testid="input-floating-chat"
              />
              <button
                onClick={sendMessage}
                disabled={!input.trim() || isLoading}
                className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white h-9 w-9 rounded-lg flex items-center justify-center shrink-0 transition-colors"
                data-testid="button-floating-send"
              >
                {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
