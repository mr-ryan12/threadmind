# ThreadMind

An AI-powered chat application with RAG (Retrieval-Augmented Generation) capabilities. Upload documents, ask questions, and get context-aware answers powered by OpenAI and pgvector.

**Live at [threadmind.dev](https://threadmind.dev)**

## Features

- **AI Chat** — Conversational interface powered by GPT-6.1 Sol via the OpenAI Responses API
- **Document Library** — Upload, browse, and delete your documents from a management dialog; documents belong to you and persist across conversations
- **Document Ingestion** — Uploaded documents are chunked, embedded, and stored for retrieval
- **Hybrid Retrieval** — Relevant document context is surfaced using pgvector similarity combined with Postgres full-text search, fused via Reciprocal Rank Fusion
- **Tool Use** — OpenAI web search with clickable citations and timezone tools the AI can call mid-conversation
- **Conversation Management** — Create, browse, and delete conversation threads
- **Auth** — Cookie-based session authentication with username login

## Tech Stack

- **Framework:** Remix v2 + Vite
- **Language:** TypeScript (strict mode)
- **Database:** PostgreSQL + pgvector
- **AI:** OpenAI Responses API (GPT-6.1 Sol for chat, GPT-6 Luna for titles); text-embedding-3-small via LangChain
- **Styling:** Tailwind CSS

## Prerequisites

- Node.js 22.x (>= 22.13) or >= 24; `.nvmrc` selects Node.js 22
- Yarn 1.x
- PostgreSQL with the [pgvector](https://github.com/pgvector/pgvector) extension enabled

## Getting Started

1. **Clone and install**

   ```bash
   git clone https://github.com/mr-ryan12/threadmind.git
   cd threadmind
   yarn install
   ```

   If you use nvm, run `nvm install` and `nvm use` before `yarn install`.

2. **Configure environment variables**

   ```bash
   cp .env.example .env
   ```

   Then fill in your `.env`:

   | Variable | Description |
   |---|---|
   | `DATABASE_URL` | PostgreSQL connection string (must have pgvector) |
   | `OPENAI_API_KEY` | OpenAI API key |
   | `SESSION_SECRET` | Secret for cookie sessions |
   | `NODE_ENV` | `development` or `production` |

3. **Set up the database**

   ```bash
   yarn migrate:latest
   ```

4. **Start the dev server**

   ```bash
   yarn dev
   ```

   The app runs at [http://localhost:3000](http://localhost:3000).

## Scripts

| Command | Description |
|---|---|
| `yarn dev` | Start dev server on port 3000 |
| `yarn build` | Production build |
| `yarn start` | Run production build |
| `yarn lint` | Run ESLint |
| `yarn typecheck` | TypeScript type check |
| `yarn test` | Run unit tests once (Vitest) |
| `yarn test:watch` | Run unit tests in watch mode |
| `yarn migrate:new` | Create a new Prisma migration (without applying) |
| `yarn migrate:latest` | Apply pending migrations |
| `yarn db:push` | Push schema to the database without migrations (prototyping) |
| `yarn prisma:generate` | Regenerate Prisma client |

## AI configuration

Chat uses `gpt-6.1-sol` with medium reasoning through `/v1/responses`.
Conversation titles use `gpt-6-luna` with reasoning disabled. Model defaults
are defined in `app/server/openai.server.ts`. The OpenAI project associated with
`OPENAI_API_KEY` must have access to both models and web search.

Web search runs through OpenAI's built-in tool; a SerpAPI key is no longer
required. Web citations are saved as links in assistant messages and remain
clickable when reopening a conversation. The timezone tool runs locally.
Responses use `store: false`; ThreadMind supplies its saved message history on
each turn and carries reasoning/tool items through any tool-call rounds.
Only final-answer text is saved as the assistant's completed reply; intermediate
commentary retains its phase during tool calls and is excluded from stored
answers. Saved assistant replies are replayed with `phase: "final_answer"`.

Document references permit combining uploads and web sources. An explicit
document-only restriction or prohibition on browsing disables web search;
negated exclusivity such as "not only my documents" does not.

Document ingestion and retrieval continue to use LangChain embeddings and
PostgreSQL/pgvector. Retrieved passages are supplied as reference material to
the chat model; documents do not need to be uploaded to OpenAI File Search.

## Troubleshooting local pgvector

If an upload fails with `could not access file "$libdir/vector"`, PostgreSQL
has the extension registered but cannot load its native library. Check the
running server and registered extension version in the app's database:

```sql
SELECT version();
SELECT extversion FROM pg_extension WHERE extname = 'vector';
SELECT '[1,2,3]'::vector;
```

Install pgvector for the **running PostgreSQL major version**, using the
registered pgvector version when restoring missing files. Homebrew's current
pgvector package targets PostgreSQL 17 and 18; it does not supply a PostgreSQL
14 library. For PostgreSQL 14 with pgvector 0.8.0, build the official `v0.8.0`
source and run both `make` and `make install` with
`PG_CONFIG=/opt/homebrew/opt/postgresql@14/bin/pg_config`. See the
[official installation instructions](https://github.com/pgvector/pgvector#installation-notes---linux-and-mac).

Recheck the vector query after installation. A Homebrew upgrade or cleanup can
require rebuilding this manually installed library. Restoring the matching
library does not require dropping the extension, recreating tables, or
re-embedding documents.
