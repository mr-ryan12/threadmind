# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Claude Steering

### Read first (canonical)
- .specify/memory/constitution.md
- .specify/memory/product.md

### Workflow
- For non-trivial changes, keep SpecKit artifacts in `.specify/specs/<feature>/` (spec → plan → tasks) up to date.

## Commands

```bash
yarn dev              # Start dev server on http://localhost:3000
yarn build            # Production build
yarn start            # Run production build
yarn lint             # ESLint
yarn typecheck        # TypeScript type check (tsc)
yarn test             # Run unit tests once (vitest)
yarn test:watch       # Run unit tests in watch mode (vitest)
yarn prisma:generate  # Generate Prisma client (run after schema changes)
yarn migrate:new      # Create a migration WITHOUT applying (--create-only). Review the
                      #   SQL and delete any drift that drops the manual GIN/HNSW indexes
                      #   or the fts generated column, THEN run migrate:latest to apply.
yarn migrate:latest   # Apply pending migrations (deploy/CI) — runs committed SQL, no diff
yarn db:push          # Push schema to DB without migrations (prototyping only)
```

## Architecture

This is a **Remix v2** app (with Vite) using file-based routing under `app/routes/`. It is a RAG-enabled AI chat app backed by PostgreSQL + pgvector.

### Route structure

- `_index.tsx` — landing/new conversation
- `conversation.$id.tsx` — main chat UI; loader fetches conversation + sidebar list; action calls `createChatCompletion`
- `api.conversation.$id.messages.tsx` — JSON API for message history
- `api.conversation.$id.delete.tsx` — delete conversation
- `login.tsx`, `signup.tsx` — auth forms
- `upload-file.tsx` — document upload route

### Core data flow: chat

`conversation.$id.tsx` action → `app/utils/chat.ts:createChatCompletion` → LangChain `ChatOpenAI` (gpt-4, temp 0) → optional tool call (`search_web` via SerpAPI, `get_time_in_timezone`) → saves user + assistant messages to DB via Prisma → returns word array for animated rendering.

Document context is injected when the message is document-related, detected by `wantsDocumentContext` (`app/server/utils/documentIntent.ts`) — broader than the old three-keyword gate.

### Core data flow: document ingestion

`upload-file.tsx` (action) → `extractTextFromFile` → `documentService.ingestDocument()` → `MarkdownTextSplitter` (1000 chars, 200 overlap) → `OpenAIEmbeddings` (text-embedding-3-small, 1536 dims) → raw SQL `INSERT` into `Document` and `DocumentChunk` tables with `::vector` casting. `DocumentChunk.fts` is a generated `tsvector` column.

Retrieval: `queryDocuments()` uses layered routing (current conversation's docs → most-recent upload → user-wide), backed by `HybridRetriever` in `documentService.ts`, which combines pgvector similarity + Postgres full-text search fused with Reciprocal Rank Fusion.

### Database (Prisma + pgvector)

Schema: `User`, `Conversation`, `Message`, `Document`, `DocumentChunk`. Embeddings stored as `vector(1536)` (pgvector). GIN indexes for `DocumentChunk.metadata` and `.fts` must be created manually in migration SQL (see comments in schema). **Note:** `Conversation` and `Message` have no `userId` column — tenant scoping is not yet implemented (gaps vs. constitution).

### Auth

Cookie-based sessions via Remix `createCookieSessionStorage`. Sessions are 30-day, HttpOnly, secure in production. `requireAuth(request)` in `app/utils/auth.server.ts` is called at the top of every protected loader/action. Passwords are hashed with bcrypt.

### Logging

Structured logging via `pino` + `pino-pretty`. Use the singleton `logger` from `app/server/utils/logger.ts`.

## Environment variables

See `.env.example`:

```
DATABASE_URL      # PostgreSQL connection string (must have pgvector extension)
OPENAI_API_KEY    # OpenAI API key
SERPAPI_KEY       # SerpAPI key (used by search_web tool)
SESSION_SECRET    # Cookie session secret
NODE_ENV          # development | production
```

## Project constitution

Engineering guardrails are defined in `.specify/memory/constitution.md`. Detailed rules are in `.claude/rules/`.

## Planning Guidelines

Create a comprehensive, repository-informed implementation plan for the feature described in:

`path/to/file/issue-<issue-number>.md`

Save the plan to:

`path/to/file/plan.md`

### Before planning

1. Read the complete feature brief, including its problem statement, scope, acceptance criteria, validation notes, and relevant files.
2. Inspect the relevant implementation, tests, package scripts, and project conventions. Read applicable `AGENTS.md` files and skills when present.
3. Ground recommendations in the repository. Cite concrete file paths and, where useful, symbols or current behavior. Do not invent files, APIs, dependencies, or existing behavior. Mark anything you could not verify.
4. Identify requirements, constraints, dependencies, risks, and decisions that affect implementation order or scope.

Ask me clarifying questions only when an unresolved answer would materially change the plan or block a safe, coherent implementation. Ask concise, prioritized questions before finalizing the plan. For non-blocking uncertainty, state a clearly labeled assumption or present the options and their tradeoffs; do not silently decide product behavior.

### Plan requirements

Write a phased plan broken into tasks that are coherent, independently reviewable units of work. Make the sequence and task dependencies explicit. Keep tasks small enough to implement and review one at a time, but do not split work into arbitrary file-by-file steps.

For each task, include:

- **Goal and changes:** the intended outcome and the key implementation work.
- **Likely files:** verified paths to modify or inspect, adding other paths only when repository discovery supports them.
- **Dependencies:** prerequisite tasks or decisions, or “None.”
- **Acceptance checks:** observable conditions that show the task is complete.
- **Validation:** the relevant tests or commands for that task, including any focused checks available in the repo.

Map every feature requirement and acceptance criterion to at least one task. Include a compact traceability section so a reviewer can confirm nothing was missed. Keep the plan within the feature brief’s proposed scope; call out scope changes or deferred work explicitly rather than adding them silently.

Include a final validation section. The feature brief requests `yarn test`, `yarn typecheck`, `yarn lint`, and `yarn build`; account for all four in the plan. Also include these commands after each implementation task, as appropriate to the task’s changes:

- `yarn test`
- `yarn typecheck`
- `yarn lint`

If running the full set after every task would be redundant or impractical, explain that in the plan and specify the focused checks to run per task, while retaining the full validation set at the appropriate phase or completion point. Do not omit a requested check without explaining why.

### Output structure

Use this structure, adapting only when the feature genuinely calls for it:

1. Purpose and scope
2. Repository findings and current behavior
3. Assumptions, open questions, and decisions
4. Phased implementation plan with numbered tasks
5. Requirement-to-task traceability
6. Risks and deferred work
7. Final validation

Write for an engineer who will execute the tasks sequentially. Make decisions and dependencies easy to find, and avoid vague tasks such as “update the UI” or “add tests” without describing what behavior changes and how completion will be checked.

### Execution boundaries

Do not modify application code, tests, configuration, dependencies, or database state during this planning session. Only create or update the planning document at the path above. Do not stage, commit, or otherwise prepare code changes for commit.

The implementation will be carried out by executing each task one at a time with the `fullstack-dev` agent. After each task, an independent, general-purpose AI agent will review the changes and report findings or state that they are okay to commit. I will perform all commits. Reflect these review and commit boundaries in the plan: agents must not commit, stage changes, or treat their work as approved until I review it.
