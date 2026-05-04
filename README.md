# Support Assistant — WP All Import

An AI-powered support ticket assistant for the WP All Import / WP All Export team at Soflyy. Uses RAG (Retrieval-Augmented Generation) to find similar past tickets and generate accurate, on-brand responses.

---

## How it works

1. **Paste** a customer ticket into the interface
2. **Search references** — the app embeds the ticket using OpenAI and searches for semantically similar past tickets in Supabase
3. **Rerank** — Claude evaluates the candidates and selects the most relevant references
4. **Generate** a response using Claude, informed by the matching references and Soflyy's base prompt rules
5. **Refine** the response via chat until it's ready to send
6. **Save** the ticket + response back to the database to improve future searches

---

## Tech stack

| Layer           | Technology                                        |
| --------------- | ------------------------------------------------- |
| Frontend        | Vanilla HTML, CSS, JavaScript (no framework)      |
| AI — Generation | Anthropic Claude Sonnet 4.6                       |
| AI — Embeddings | OpenAI `text-embedding-3-small` (1536 dimensions) |
| Database        | Supabase (PostgreSQL + pgvector extension)        |
| Hosting         | Vercel (auto-deploy from GitHub)                  |

---

## Project structure

```
support-assistant/
├── index.html           # HTML structure (views: New Ticket, History, Settings)
├── styles.css           # All CSS styles and design tokens
├── app.js               # All JavaScript — state, API calls, UI rendering
├── config.js            # API keys — GITIGNORED, never committed
├── config.example.js    # Template for config.js — safe to commit
├── .gitignore           # Excludes config.js and other sensitive files
└── README.md            # This file
```

---

## Local setup

### 1. Clone the repository

```bash
git clone https://github.com/gjcedeno/support-assistant-v2.git
cd support-assistant-v2
```

### 2. Create your config file

```bash
cp config.example.js config.js
```

Open `config.js` and fill in your API keys:

```js
const CONFIG = {
  ANTHROPIC_KEY: "sk-ant-...", // from console.anthropic.com
  OPENAI_KEY: "sk-...", // from platform.openai.com
  SUPABASE_URL: "...", // from Supabase Dashboard → Project Settings
  SUPABASE_ANON: "...", // from Supabase Dashboard → Project Settings
};
```

### 3. Open the app

Open `index.html` directly in your browser — no build step or server required.

---

## Deployment (Vercel)

The app is deployed automatically via Vercel on every push to the `main` branch.

Live URL: https://support-assistant-v2.vercel.app/

To deploy manually:

1. Push changes to GitHub
2. Vercel detects the push and deploys within 1-2 minutes

> **Note:** `config.js` is gitignored and not deployed to Vercel. API keys in production are entered by the user through the Settings view and stored in the browser's `localStorage`.

---

## Database (Supabase)

**Table: `tickets`**

| Column         | Type         | Description                                            |
| -------------- | ------------ | ------------------------------------------------------ |
| `id`           | int8         | Auto-increment primary key                             |
| `ticket`       | text         | Original customer ticket text                          |
| `conversation` | text         | Agent response (format: `Customer: ...\n\nAgent: ...`) |
| `embedding`    | vector(1536) | OpenAI embedding of the ticket text                    |
| `from_pdf`     | boolean      | Whether this was imported from a PDF                   |
| `created_at`   | timestamptz  | Auto-set on insert                                     |

**SQL function: `match_tickets`**

Used for cosine similarity search via pgvector:

```sql
match_tickets(query_embedding vector, match_threshold float, match_count int)
```

---

## Key parameters

| Parameter            | Value                    | Description                                      |
| -------------------- | ------------------------ | ------------------------------------------------ |
| Embedding model      | `text-embedding-3-small` | OpenAI model for vector generation               |
| Vector dimensions    | 1536                     | Size of embedding vectors                        |
| Similarity threshold | 0.35                     | Minimum cosine similarity to include a reference |
| Candidates fetched   | 15                       | Results from Supabase before reranking           |
| References shown     | Up to 10                 | After Claude reranks the 15 candidates           |
| Max response tokens  | 1200                     | Claude's response length limit                   |

---

## Importing historical tickets

A Python import script is available separately (`import_chatgpt.py`) to bulk-import conversations from ChatGPT exports into Supabase.

Requirements: `pip install requests`

---
