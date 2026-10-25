---
name: prisma-expert
description: Prisma and pgvector expertise for this project — schema, queries, migrations, and raw SQL patterns
user-invokable: false
---

# Prisma Expert

This project uses **Prisma with PostgreSQL + pgvector**. The client singleton is in `app/server/db.server.ts`.

## Importing the client

Always import from the singleton — never instantiate `PrismaClient` directly elsewhere:
```ts
import { prisma } from "~/server/db.server";
```

## Schema models

```
User            — id, username (unique), password, firstName, lastName, createdAt
Conversation    — id, title?, createdAt, updatedAt, messages[]
Message         — id, content, role (enum: user|assistant), createdAt, conversationId
Document        — id, title?, embedding (vector(1536)), metadata (Json?), chunks[]
DocumentChunk   — id, documentId, content, embedding (vector(1536)), section?, page?,
                  orderInDoc?, metadata (Json?), fts (tsvector?), createdAt
```

**Known gap:** `Conversation` and `Message` have no `userId` — tenant scoping is not yet implemented. A migration is required before next release. Do not write queries that assume these models are user-scoped yet; flag the gap if it's relevant.

## Query discipline

Always use `select` to fetch only the fields you need. Only use `include` when a full relation is required:
```ts
// Good — fetch only what's needed
const conversations = await prisma.conversation.findMany({
  select: { id: true, title: true, updatedAt: true },
  orderBy: { updatedAt: "desc" },
});

// Use include when you genuinely need the relation
const conversation = await prisma.conversation.findUnique({
  where: { id },
  include: { messages: true },
});
```

Avoid N+1 patterns. Fetch related data in a single query using `include` or `_count`, not in a loop.

## Tenant scoping

All queries on user data must be scoped by `userId` (and `conversationId` where applicable). Enforce this in service helpers — never hand-roll per route. Example once `userId` is added to `Conversation`:
```ts
await prisma.conversation.findMany({
  where: { userId },
  select: { id: true, title: true },
});
```

## Error handling — all async ops in try/catch

Every Prisma call must be inside a `try/catch`. Never let a Prisma error propagate unhandled. Service functions may re-throw; route handlers must catch and return a typed response:
```ts
export async function getConversation(id: string): Promise<Conversation | null> {
  try {
    return await prisma.conversation.findUnique({
      where: { id },
      include: { messages: true },
    });
  } catch (error) {
    logger.logError(error, { duration: 0, path: "/", method: "GET" });
    throw error;
  }
}
```

Use `logger` from `~/server/utils/logger` — never `console.log` or `console.error`.

## pgvector — embeddings and similarity search

Vector fields are `Unsupported("vector(1536)")` in the schema — Prisma cannot read/write them directly. Use raw SQL exclusively for anything involving embeddings.

**Inserting with a vector value** — use `$executeRawUnsafe` with `::vector` casting:
```ts
await prisma.$executeRawUnsafe(
  `INSERT INTO "DocumentChunk" (id, "documentId", content, embedding, "createdAt")
   VALUES ($1, $2, $3, $4::vector, $5)`,
  uuid(),
  documentId,
  content,
  embeddingArray,
  new Date(),
);
```

**Querying by similarity** — use `$queryRaw` with the `<->` cosine distance operator:
```ts
const chunks = await prisma.$queryRaw<DocumentChunk[]>`
  SELECT id, content, embedding <-> ${queryEmbedding}::vector AS distance
  FROM "DocumentChunk"
  ORDER BY distance ASC
  LIMIT 3
`;
```

Default top-k is 3; hard cap is 10. Never exceed without explicit spec justification.

## GIN indexes

GIN indexes for `DocumentChunk.metadata` and `.fts` cannot be expressed in the Prisma schema. They must be created manually in the migration SQL file:
```sql
CREATE INDEX chunk_metadata_idx ON "DocumentChunk" USING GIN (metadata);
CREATE INDEX chunk_fts_idx ON "DocumentChunk" USING GIN (fts);
```

Always add these to any migration that creates or recreates the `DocumentChunk` table.

## Migrations

- Schema changes always require a migration: `yarn migrate:new`
- Apply in CI/deploy with: `yarn migrate:latest`
- After any schema change run: `yarn prisma:generate`
- Every migration must include rollback notes and a backfill plan if existing rows are affected
- Never use `yarn db:push` outside local prototyping

## Document deletion

Deleting a `Document` must also delete or mark unreachable all associated `DocumentChunk` rows and remove them from retrieval results. Cascade deletes should be defined at the schema level or handled explicitly in the service layer.

## Where DB code lives

All Prisma access belongs in `app/server/` — either in `app/server/utils/apiCalls/` for per-entity helpers or `app/server/utils/` for broader services (e.g. `documentService.ts`). Never query the DB directly from a route file.
