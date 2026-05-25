# ChitChat

A minimal AI chatbot that uses [Foldin](https://www.npmjs.com/package/@vedsu/foldin) to compress conversation history and displays live token savings per message.

Built with **React + Vite + Groq**.

![ChitChat showing 85% token savings](./screenshot.png)

> **85% fewer tokens sent** after just 2 turns — 454 tokens with Foldin vs 3111 without.

---

## How it works

Most chatbots send the entire conversation history to the model on every turn. As the conversation grows, so does your token bill — linearly.

ChitChat integrates [Foldin](https://www.npmjs.com/package/@vedsu/foldin), a context compression package that distills prior conversation into a compact facts summary. Instead of re-sending every past message, Foldin sends:

1. A compressed `[Facts]` system prompt extracted from the conversation so far
2. The current user message

That's it — 2 messages per turn, regardless of how long the conversation gets.

The header shows live stats every turn so you can watch the savings compound in real time.

---

## Token savings

| | With Foldin | Without Foldin | Saved |
|---|---|---|---|
| After 2 turns | 454 tokens | 3,111 tokens | **85% (2,657 tokens)** |

Savings start from **turn 3** and hold or improve as the conversation grows, since naive context grows linearly while Foldin stays nearly flat.

---

## Setup

```bash
npm install
```

Add a `.env` file:

```
VITE_GROQ_API_KEY=your_key_here
```

```bash
npm run dev
```

---

## Stack

- [React](https://react.dev/) + [Vite](https://vitejs.dev/) — frontend
- [Groq](https://groq.com/) — LLM inference (Llama 3.3 · 70B)
- [@vedsu/foldin](https://www.npmjs.com/package/@vedsu/foldin) — context compression

---

## Project structure

```
chitchat/
├── src/
│   └── App.jsx        # Main chat UI + Foldin integration
├── .env               # VITE_GROQ_API_KEY (not committed)
├── index.html
└── package.json
```

---

## Credits

Built by [Ved](https://github.com/veecodes07) · Compression powered by [@vedsu/foldin](https://www.npmjs.com/package/@vedsu/foldin)
