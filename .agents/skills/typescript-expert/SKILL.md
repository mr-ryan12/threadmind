---
name: typescript-expert
description: TypeScript conventions for this project — strict mode, types, error handling, imports, and naming
user-invokable: false
---

# TypeScript Expert

This project runs TypeScript with `strict: true`, `isolatedModules: true`, `target: ES2022`, and `moduleResolution: "Bundler"`. Vite handles compilation — `tsc` is type-check only (`noEmit: true`). Run `yarn typecheck` to verify.

## Strict mode — what it requires

With `strict: true` the following are all on:

- `strictNullChecks` — `null` and `undefined` are not assignable to other types without explicit handling
- `noImplicitAny` — every binding must have an inferrable or explicit type
- `strictFunctionTypes`, `strictPropertyInitialization`, etc.

Never disable strict mode or add `// @ts-ignore` / `// @ts-nocheck` to work around type errors. Fix the root cause.

## Explicit return types

Required on all non-trivial functions — loaders, actions, service functions, utilities. Omit only for simple one-liners where the return type is obvious and inferred:

```ts
// Required
export async function getConversation(id: string): Promise<Conversation | null> { ... }

// Fine to omit — obvious from context
const double = (n: number) => n * 2;
```

## Path alias

`~/` resolves to `app/`. Always use it for imports within the app — never use relative `../..` paths that cross the `app/` boundary:

```ts
import { prisma } from "~/server/db.server";
import { logger } from "~/server/utils/logger";
import type { Conversation } from "~/types/conversation.types";
```

## Type-only imports — isolatedModules

`isolatedModules: true` requires type imports to use `import type`. Use it for any import that is a type or interface only:

```ts
import type { Conversation } from "~/types/conversation.types";
import type { LoaderFunctionArgs } from "@remix-run/node";

// Value + type from the same module — split them
import { data } from "@remix-run/node";
import type { ActionFunctionArgs } from "@remix-run/node";
```

## Where types live

Shared types live in `app/types/`, one file per domain, named `<domain>.types.ts`:

```
app/types/
  conversation.types.ts
  chat.types.ts
  documentChunk.types.ts
  logger.types.ts
```

Do not co-locate types with implementation files unless the type is truly private to that module.

## Naming conventions

| Kind          | Convention                                                       | Example                                        |
| ------------- | ---------------------------------------------------------------- | ---------------------------------------------- |
| Interface     | `I` prefix for service/infra shapes; no prefix for domain models | `ILogRequest`, `Conversation`, `DocumentChunk` |
| Type alias    | `T` prefix                                                       | `TServiceName`                                 |
| Function      | verb                                                             | `fetchMessages`, `createEmbedding`             |
| Variable/prop | noun                                                             | `conversationId`, `messageCount`               |
| Boolean       | `is`/`has`/`can` prefix                                          | `isValid`, `hasError`                          |

Avoid ambiguous names like `data`, `info`, `result` outside narrow local scopes.

## Error handling — unknown over any

Caught errors are typed `unknown`. Always narrow before accessing properties:

```ts
try {
  await someOperation();
} catch (error) {
  // Correct
  logger.logError(error, { ... });
  const message = error instanceof Error ? error.message : String(error);

  // Wrong — error is unknown, not any
  console.log(error.message); // TS error
}
```

## Avoid type assertions — prefer type guards

Prefer type guards and narrowing over `as` casts. Reserve `as` for cases where you have genuine knowledge the compiler lacks (e.g. form data values):

```ts
// Acceptable — form values are always string | File
const message = formData.get("message") as string;

// Avoid — use a type guard instead
const user = response as User;

// Better
function isUser(value: unknown): value is User {
  return typeof value === "object" && value !== null && "id" in value;
}
```

## Non-null assertion

Avoid `!` except at environment variable initialisation points, where the app will crash-fast on startup if the value is missing:

```ts
// Acceptable at initialisation boundary
secrets: [process.env.SESSION_SECRET!];

// Avoid elsewhere — use nullish coalescing or early return instead
const title = conversation.title ?? "New Conversation";
```

## Utility types

Prefer built-in utility types over manual re-declaration:

- `Partial<T>` — all fields optional
- `Required<T>` — all fields required
- `Pick<T, K>` — subset of fields
- `Omit<T, K>` — exclude fields
- `Record<K, V>` — object with known key/value shape
- `ReturnType<typeof fn>` — infer return type from a function

## ES2022 features in use

These are available and encouraged:

- `await` at top level in modules
- `Array.at()`, `Object.hasOwn()`
- Optional chaining `?.` and nullish coalescing `??`
- Logical assignment `??=`, `&&=`, `||=`
