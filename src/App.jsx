import { useEffect, useRef, useState } from "react";
import createFold from "@vedsu/foldin";

const CHAT_MODEL = "llama3.2:3b";
const COMPRESS_MODEL = "llama3.2:3b";
const CONVERSATION_ID = "chat-001";

const storage = {
  get: async (id) => {
    const val = localStorage.getItem(`foldin:${id}`);
    return val ? JSON.parse(val) : null;
  },
  set: async (id, state) => {
    localStorage.setItem(`foldin:${id}`, JSON.stringify(state));
  },
};

const compress = async (prompt) => {
  const res = await fetch("http://localhost:11434/api/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: COMPRESS_MODEL,
      messages: [{ role: "user", content: prompt }],
      stream: false,
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error || `Compression failed with status ${res.status}`);
  }
  if (data.error) throw new Error(data.error.message || data.error);
  return data.message.content;
};

const fold = createFold({ storage, compress });

async function callAI(messages) {
  const res = await fetch("http://localhost:11434/api/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: CHAT_MODEL,
      messages,
      stream: false,
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error || `Chat failed with status ${res.status}`);
  }
  if (data.error) throw new Error(data.error.message || data.error);
  return data.message.content;
}

function estimateTokens(messages) {
  const text = messages
    .map((m) => `${m.role}: ${m.content}`)
    .join("\n");

  return Math.max(1, Math.round(text.length / 4));
}

function renderMarkdown(text) {
  const lines = text.split("\n");
  const elements = [];
  let key = 0;

  for (const line of lines) {
    const numberedMatch = line.match(/^(\d+)\.\s+\*\*(.+?)\*\*(.*)$/);
    if (numberedMatch) {
      elements.push(
        <div key={key++} style={{ marginBottom: 10, display: "flex", gap: 8 }}>
          <span style={{ color: "var(--accent)", fontWeight: 500, flexShrink: 0 }}>
            {numberedMatch[1]}.
          </span>
          <span>
            <strong>{numberedMatch[2]}</strong>
            {numberedMatch[3]}
          </span>
        </div>
      );
      continue;
    }

    if (line.includes("**")) {
      const parts = line.split(/\*\*(.+?)\*\*/g);
      const rendered = parts.map((part, idx) =>
        idx % 2 === 1 ? <strong key={idx}>{part}</strong> : part
      );
      elements.push(
        <p key={key++} style={{ marginBottom: 6 }}>
          {rendered}
        </p>
      );
      continue;
    }

    if (line.trim() === "") {
      elements.push(<div key={key++} style={{ height: 6 }} />);
      continue;
    }

    elements.push(
      <p key={key++} style={{ marginBottom: 6 }}>
        {line}
      </p>
    );
  }

  return elements;
}

export default function App() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [turnCount, setTurnCount] = useState(0);

  // totalTokensSent: running sum of tokens actually sent each turn (with Foldin)
  const [totalTokensSent, setTotalTokensSent] = useState(0);
  // totalTokensRaw: running sum of tokens that WOULD have been sent each turn (naive, no compression)
  const [totalTokensRaw, setTotalTokensRaw] = useState(0);

  // Tracks the full uncompressed history for naive cost simulation
  const rawHistoryRef = useRef([]);

  const bottomRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);
  useEffect(() => {
  localStorage.removeItem(`foldin:${CONVERSATION_ID}`);
  fold.reset(CONVERSATION_ID);
  setTurnCount(0);
  setTotalTokensSent(0);
  setTotalTokensRaw(0);
  rawHistoryRef.current = [];
}, []);

  function handleNewChat() {
    fold.reset(CONVERSATION_ID);
    localStorage.removeItem(`foldin:${CONVERSATION_ID}`);
    setMessages([]);
    setTurnCount(0);
    setTotalTokensSent(0);
    setTotalTokensRaw(0);
    rawHistoryRef.current = [];
    setInput("");
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  async function handleSend() {
    const text = input.trim();
    if (!text || loading) return;

    const userMsg = { role: "user", content: text };
    const newMessages = [...messages, userMsg];

    setMessages(newMessages);
    setInput("");
    setLoading(true);

    try {
      // --- Foldin cost: what we actually send this turn (compressed) ---
      const { messages: packedMessages } = await fold.pack(CONVERSATION_ID, text);
      const packedTurnTokens = estimateTokens(packedMessages);

      // DEBUG — remove once compression is verified working
      console.group(`[Foldin] Turn ${rawHistoryRef.current.length / 2 + 1}`);
      console.log("packed message count:", packedMessages.length);
      console.log("packed tokens (estimated):", packedTurnTokens);
      console.log("raw history length:", rawHistoryRef.current.length);
      console.log("packed messages:", JSON.stringify(packedMessages, null, 2));
      console.groupEnd();

      const reply = await callAI(packedMessages);
      fold.update(CONVERSATION_ID, text, reply);
      setTurnCount((prev) => prev + 1);

      // Update raw history to include this full turn (user + assistant)
      rawHistoryRef.current = [
        ...rawHistoryRef.current,
        { role: "user", content: text },
        { role: "assistant", content: reply },
      ];

      // --- Compare same-turn context window sizes ---
      // Naive: the full uncompressed history is what a naive client would send
      //        on the NEXT turn — this is a point-in-time snapshot, not a sum.
      // Foldin: running sum of what was actually sent each turn (packed tokens).
      //
      // Displaying snapshot vs sum gives: "if you sent one message right now,
      // naive would cost X tokens; Foldin has cost Y tokens across all turns so far."
      // Better comparison: both as snapshots of THIS turn's cost.
      //
      // Naive this turn = full history that was the input context for this turn
      // = rawHistory BEFORE adding the reply (what was sent in to get the reply)
      const naiveThisTurnSnapshot = estimateTokens([
        ...rawHistoryRef.current.slice(0, -2), // history before this turn
        { role: "user", content: text },        // the user message sent this turn
      ]);

      setTotalTokensRaw((prev) => prev + naiveThisTurnSnapshot);
      setTotalTokensSent((prev) => prev + packedTurnTokens);

      setMessages([...newMessages, { role: "assistant", content: reply }]);
    } catch (err) {
      setMessages([
        ...newMessages,
        { role: "assistant", content: `Error: ${err.message}` },
      ]);
    } finally {
      setLoading(false);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }

  function handleKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  const tokensSaved = totalTokensRaw - totalTokensSent;
  const savingsPct = totalTokensRaw > 0
    ? Math.round((tokensSaved / totalTokensRaw) * 100)
    : 0;

  // Only show stats once there's enough history for compression to kick in
  const showStats = turnCount >= 1 && totalTokensRaw > 0;

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
          --red: #e07070;
          --radius: 16px;
          --font-display: 'DM Serif Display', serif;
          --font-body: 'DM Sans', sans-serif;
        }

        html, body, #root { height: 100%; }

        body {
          background: var(--bg);
          color: var(--text);
          font-family: var(--font-body);
          font-weight: 300;
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

        .header {
          padding: 18px 32px;
          border-bottom: 1px solid var(--border);
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          flex-shrink: 0;
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

        .new-chat-btn {
          background: transparent;
          border: 1px solid var(--border);
          color: var(--muted);
          border-radius: 8px;
          padding: 6px 12px;
          font-size: 11px;
          cursor: pointer;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          font-family: var(--font-body);
          transition: border-color 0.2s, color 0.2s;
        }

        .new-chat-btn:hover { border-color: var(--accent); color: var(--accent); }

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
        .stat-value.red { color: var(--red); }
        .stat-value.muted { color: var(--muted); font-size: 11px; }

        .stat-label {
          font-size: 9px;
          color: var(--muted);
          text-transform: uppercase;
          letter-spacing: 0.08em;
          font-weight: 400;
        }

        .stat-divider { width: 1px; height: 24px; background: var(--border); }

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
          background: #1c1c1e;
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
            <h1 className="header-title">
              chit<span>chat</span>
            </h1>
            <span className="header-model">Llama 3.3 · 70B</span>
          </div>

          {showStats && (
            <div className="stats-bar">
              <div className="stat">
  <span className="stat-value">{turnCount}</span>
  <span className="stat-label">Turns</span>
</div>
<div className="stat-divider" />
              <div className="stat">
                <span className="stat-value">{totalTokensSent}</span>
                <span className="stat-label">With Foldin</span>
              </div>
              <div className="stat-divider" />
              <div className="stat">
                <span className="stat-value">{totalTokensRaw}</span>
                <span className="stat-label">Without Foldin</span>
              </div>
              <div className="stat-divider" />
              <div className="stat">
               {turnCount <= 2 ? (
  <>
    <span className="stat-value muted">warming up</span>
    <span className="stat-label">compression ramping</span>
  </>
) : tokensSaved >= 0 ? (
  <>
    <span className="stat-value green">{savingsPct}% saved</span>
    <span className="stat-label">{tokensSaved} tokens total</span>
  </>
) : (
  <>
    <span className="stat-value green">{savingsPct}% saved</span>
    <span className="stat-label">{tokensSaved} tokens total</span>
  </>
)}
              </div>
            </div>
          )}

          <button className="new-chat-btn" onClick={handleNewChat}>
            New chat
          </button>
        </header>

        <div className="messages">
          {messages.length === 0 && !loading ? (
            <div className="empty">
              <div className="empty-title">
                What&apos;s on your <em>mind?</em>
              </div>
              <p className="empty-sub">
                Chat normally. ChitChat compresses context in the background —
                saving tokens every turn.
              </p>
            </div>
          ) : (
            <>
              {messages.map((msg, i) => (
                <div key={i} className={`message-row ${msg.role}`}>
                  <div className={`role-label ${msg.role === "assistant" ? "accent" : ""}`}>
                    {msg.role === "user" ? "You" : "Foldin"}
                  </div>
                  <div className={`bubble ${msg.role}`}>
                    {msg.role === "assistant" ? renderMarkdown(msg.content) : msg.content}
                  </div>
                </div>
              ))}

              {loading && (
                <div className="message-row assistant">
                  <div className="role-label accent">Foldin</div>
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
                e.target.style.height = `${Math.min(e.target.scrollHeight, 140)}px`;
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
                <path
                  d="M2 8L14 8M14 8L9 3M14 8L9 13"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>
          <p className="input-hint">Enter to send · Shift+Enter for new line</p>
        </div>
      </div>
    </>
  );
}