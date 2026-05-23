import { useState, useRef, useEffect } from "react";
import createFold from "@vedsu/foldin";

const GROQ_API_KEY = import.meta.env.VITE_GROQ_API_KEY;
const CHAT_MODEL = "llama-3.3-70b-versatile";
const COMPRESS_MODEL = "llama-3.1-8b-instant";
// const CHAT_MODEL = "qwen/qwen3-coder:free";
// const COMPRESS_MODEL = "qwen/qwen3-coder:free"; 
const CONVERSATION_ID = "chat-001";

// ─── In-memory storage ────────────────────────────────────────────────────────
const db = new Map();
const storage = {
  get: async (id) => db.get(id) ?? null,
  set: async (id, state) => db.set(id, state),
};

// ─── Compress function ────────────────────────────────────────────────────────
const compress = async (prompt) => {
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      // 
      "Authorization": `Bearer ${import.meta.env.VITE_GROQ_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: COMPRESS_MODEL,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 300,
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.choices[0].message.content;
};

// ─── Fold instance ────────────────────────────────────────────────────────────
const fold = createFold({ storage, compress });

// ─── Chat API call ────────────────────────────────────────────────────────────
async function callGroq(messages) {
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${import.meta.env.VITE_GROQ_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: CHAT_MODEL,
      messages,
      max_tokens: 1000,
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.choices[0].message.content;
}

export default function App() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState(null);
  const [totalSaved, setTotalSaved] = useState(0);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);
  const cumulativeRaw = useRef(0);
  const cumulativeSent = useRef(0);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  async function handleSend() {
    const text = input.trim();
    if (!text || loading) return;

    const userMsg = { role: "user", content: text };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput("");
    setLoading(true);

    try {
      const { messages: packedMessages } = await fold.pack(CONVERSATION_ID, text);

      // Tokens actually sent (packed)
      const tokensSent = Math.round(JSON.stringify(packedMessages).length / 4);

      // Tokens that would've been sent (full raw history)
      const rawHistory = newMessages.map(m => m.content).join(" ");
      const tokensWouldBe = Math.round(rawHistory.length / 4);

      const reply = await callGroq(packedMessages);
      fold.update(CONVERSATION_ID, text, reply);

      // Accumulate totals
      cumulativeRaw.current += tokensWouldBe;
      cumulativeSent.current += tokensSent;
      const savedPct = Math.max(0, Math.round((1 - cumulativeSent.current / cumulativeRaw.current) * 100));
      const savedTokens = cumulativeRaw.current - cumulativeSent.current;

      setStats({ tokensSent, tokensWouldBe, savedPct });
      setTotalSaved(savedTokens);
      setMessages([...newMessages, { role: "assistant", content: reply }]);
    } catch (err) {
      setMessages([...newMessages, { role: "assistant", content: `Error: ${err.message}` }]);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }

  function handleKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=DM+Sans:wght@300;400;500&display=swap');

        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        :root {
          --bg: #0e0e0f;
          --surface: #161617;
          --border: #252527;
          --text: #e8e6e1;
          --muted: #6b6966;
          --accent: #c9a96e;
          --green: #6fba8a;
          --radius: 16px;
          --font-display: 'DM Serif Display', serif;
          --font-body: 'DM Sans', sans-serif;
        }

        body {
          background: var(--bg);
          color: var(--text);
          font-family: var(--font-body);
          font-weight: 300;
          height: 100dvh;
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }

        .app {
          display: flex;
          flex-direction: column;
          height: 100dvh;
          max-width: 760px;
          margin: 0 auto;
          width: 100%;
        }

        /* Header */
        .header {
          padding: 18px 32px;
          border-bottom: 1px solid var(--border);
          display: flex;
          align-items: center;
          justify-content: space-between;
          flex-shrink: 0;
          gap: 12px;
        }

        .header-left {
          display: flex;
          align-items: baseline;
          gap: 10px;
        }

        .header-title {
          font-family: var(--font-display);
          font-size: 20px;
          color: var(--text);
          letter-spacing: -0.01em;
        }

        .header-title span { color: var(--accent); font-style: italic; }

        .header-model {
          font-size: 11px;
          color: var(--muted);
          letter-spacing: 0.08em;
          text-transform: uppercase;
          font-weight: 400;
        }

        /* Stats bar */
        .stats-bar {
          display: flex;
          align-items: center;
          gap: 16px;
          animation: fadeIn 0.4s ease;
        }

        .stat {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: 1px;
        }

        .stat-value {
          font-size: 13px;
          font-weight: 500;
          color: var(--text);
          letter-spacing: -0.02em;
        }

        .stat-value.green { color: var(--green); }
        .stat-value.accent { color: var(--accent); }

        .stat-label {
          font-size: 9px;
          color: var(--muted);
          text-transform: uppercase;
          letter-spacing: 0.08em;
          font-weight: 400;
        }

        .stat-divider {
          width: 1px;
          height: 24px;
          background: var(--border);
        }

        /* Messages */
        .messages {
          flex: 1;
          overflow-y: auto;
          padding: 32px 32px 16px;
          display: flex;
          flex-direction: column;
          gap: 2px;
          scrollbar-width: thin;
          scrollbar-color: var(--border) transparent;
        }

        .messages::-webkit-scrollbar { width: 4px; }
        .messages::-webkit-scrollbar-track { background: transparent; }
        .messages::-webkit-scrollbar-thumb { background: var(--border); border-radius: 4px; }

        .empty {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 8px;
          text-align: center;
          padding: 40px;
          animation: fadeIn 0.6s ease;
        }

        .empty-title {
          font-family: var(--font-display);
          font-size: 32px;
          color: var(--text);
          letter-spacing: -0.02em;
        }

        .empty-title em { color: var(--accent); }

        .empty-sub {
          font-size: 14px;
          color: var(--muted);
          font-weight: 300;
          max-width: 280px;
          line-height: 1.6;
        }

        .message-row {
          display: flex;
          flex-direction: column;
          animation: slideUp 0.25s ease;
        }

        .message-row.user { align-items: flex-end; margin-bottom: 16px; }
        .message-row.assistant { align-items: flex-start; margin-bottom: 16px; }

        .bubble {
          max-width: 82%;
          padding: 12px 16px;
          border-radius: var(--radius);
          font-size: 14.5px;
          line-height: 1.65;
          font-weight: 300;
        }

        .bubble.user {
          background: var(--user-bg, #1c1c1e);
          border: 1px solid var(--border);
          border-bottom-right-radius: 4px;
          color: var(--text);
        }

        .bubble.assistant {
          background: transparent;
          color: var(--text);
          border-bottom-left-radius: 4px;
          padding-left: 0;
        }

        .role-label {
          font-size: 10px;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: var(--muted);
          margin-bottom: 6px;
          font-weight: 500;
        }

        .role-label.accent { color: var(--accent); }

        .typing {
          display: flex;
          align-items: center;
          gap: 5px;
          padding: 12px 0;
          animation: fadeIn 0.2s ease;
        }

        .dot {
          width: 5px;
          height: 5px;
          border-radius: 50%;
          background: var(--muted);
          animation: pulse 1.4s ease-in-out infinite;
        }

        .dot:nth-child(2) { animation-delay: 0.2s; }
        .dot:nth-child(3) { animation-delay: 0.4s; }

        /* Input */
        .input-area {
          padding: 16px 32px 28px;
          flex-shrink: 0;
        }

        .input-wrap {
          display: flex;
          align-items: flex-end;
          gap: 10px;
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--radius);
          padding: 12px 14px;
          transition: border-color 0.2s ease;
        }

        .input-wrap:focus-within { border-color: var(--accent); }

        textarea {
          flex: 1;
          background: transparent;
          border: none;
          outline: none;
          color: var(--text);
          font-family: var(--font-body);
          font-size: 14.5px;
          font-weight: 300;
          resize: none;
          line-height: 1.5;
          max-height: 140px;
          min-height: 22px;
          height: 22px;
          overflow-y: auto;
          caret-color: var(--accent);
        }

        textarea::placeholder { color: var(--muted); }

        .send-btn {
          background: var(--accent);
          border: none;
          border-radius: 10px;
          width: 34px;
          height: 34px;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          flex-shrink: 0;
          transition: opacity 0.2s ease, transform 0.15s ease;
          color: #0e0e0f;
        }

        .send-btn:hover:not(:disabled) { opacity: 0.85; transform: scale(1.05); }
        .send-btn:disabled { opacity: 0.3; cursor: not-allowed; }

        .input-hint {
          font-size: 11px;
          color: var(--muted);
          text-align: center;
          margin-top: 10px;
          letter-spacing: 0.02em;
        }

        @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
        @keyframes slideUp { from { opacity: 0; transform: translateY(8px) } to { opacity: 1; transform: translateY(0) } }
        @keyframes pulse {
          0%, 100% { opacity: 0.3; transform: scale(0.9); }
          50% { opacity: 1; transform: scale(1.1); }
        }
      `}</style>

      <div className="app">
        <header className="header">
          <div className="header-left">
            <h1 className="header-title">chit<span>chat</span></h1>
            <span className="header-model">Llama 3.3 · 70B</span>
          </div>

          {stats && (
            <div className="stats-bar">
              <div className="stat">
                <span className="stat-value">{stats.tokensSent}</span>
                <span className="stat-label">Tokens sent</span>
              </div>
              <div className="stat-divider" />
              <div className="stat">
                <span className="stat-value">{stats.tokensWouldBe}</span>
                <span className="stat-label">Without Foldin</span>
              </div>
              <div className="stat-divider" />
              <div className="stat">
                <span className="stat-value green">{stats.savedPct}% saved</span>
                <span className="stat-label">{totalSaved} tokens total</span>
              </div>
            </div>
          )}
        </header>

        <div className="messages">
          {messages.length === 0 && !loading ? (
            <div className="empty">
              <div className="empty-title">What's on your <em>mind?</em></div>
              <p className="empty-sub">Chat normally. ChitChat compresses context in the background — saving tokens every turn.</p>
            </div>
          ) : (
            <>
              {messages.map((msg, i) => (
                <div key={i} className={`message-row ${msg.role}`}>
                  <div className={`role-label ${msg.role === "assistant" ? "accent" : ""}`}>
                    {msg.role === "user" ? "You" : "Foldin"}
                  </div>
                  <div className={`bubble ${msg.role}`}>{msg.content}</div>
                </div>
              ))}
              {loading && (
                <div className="message-row assistant">
                  <div className="role-label accent">Fold</div>
                  <div className="typing">
                    <div className="dot" />
                    <div className="dot" />
                    <div className="dot" />
                  </div>
                </div>
              )}
            </>
          )}
          <div ref={bottomRef} />
        </div>

        <div className="input-area">
          <div className="input-wrap">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                e.target.style.height = "22px";
                e.target.style.height = Math.min(e.target.scrollHeight, 140) + "px";
              }}
              onKeyDown={handleKeyDown}
              placeholder="Say something..."
              rows={1}
              autoFocus
            />
            <button
              className="send-btn"
              onClick={handleSend}
              disabled={!input.trim() || loading}
              aria-label="Send"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M2 8L14 8M14 8L9 3M14 8L9 13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          </div>
          <p className="input-hint">Enter to send · Shift+Enter for new line</p>
        </div>
      </div>
    </>
  );
}