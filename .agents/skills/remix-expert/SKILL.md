---
name: remix-expert
description: Remix v2 expertise for this project — loaders, actions, routing, error handling, and data patterns
user-invokable: false
---

# Remix Expert

This project uses **Remix v2 with Vite** and file-based routing under `app/routes/`.

## Returning data from loaders and actions

`json()` is **deprecated** — never use it. Use one of two patterns instead:

**Plain object** — for success responses with no custom status code:
```ts
return { user, conversations };
```

**`data()` helper** — when you need to set a status code:
```ts
import { data } from "@remix-run/node";

return data({ error: "Not found" }, { status: 404 });
```

Import `data` from `@remix-run/node` in server modules, `@remix-run/react` in shared/client modules.

## Loader and action signatures

Always use the typed arg interfaces:
```ts
import { data, LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";

export async function loader({ request, params }: LoaderFunctionArgs) { ... }
export async function action({ request }: ActionFunctionArgs) { ... }
```

## Auth

Call `requireAuth(request)` as the **first line** of every protected loader and action — before any other async work:
```ts
import { requireAuth } from "~/utils/auth.server";

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAuth(request);
  // ...
}
```

## Error handling — no unhandled errors

Every `await` that can fail must be inside a `try/catch`. No exceptions.

**Loader pattern:**
```ts
export async function loader({ request, params }: LoaderFunctionArgs) {
  await requireAuth(request);

  try {
    const result = await someAsyncOperation();
    return { result };
  } catch (error) {
    logger.logError(error, { path: "/your-route", method: "GET", duration: 0 });
    return data({ error: "Failed to load data" }, { status: 500 });
  }
}
```

**Action pattern:**
```ts
export async function action({ request }: ActionFunctionArgs) {
  await requireAuth(request);

  const formData = await request.formData();
  const value = formData.get("field") as string;

  if (!value) {
    return data({ error: "Field is required" }, { status: 400 });
  }

  try {
    const result = await someAsyncOperation(value);
    return { result };
  } catch (error) {
    logger.logError(error, { path: "/your-route", method: "POST", duration: 0 });
    return data({ error: "Operation failed" }, { status: 500 });
  }
}
```

Validation (missing fields, bad params) is checked **before** the `try/catch` and returns early with a `400`. The `try/catch` covers the actual async work.

## Accessing loader data in components

Use `useLoaderData` with the `typeof loader` generic for full type inference — never cast the result manually:
```ts
import { useLoaderData } from "@remix-run/react";

export default function MyPage() {
  const { user, conversations } = useLoaderData<typeof loader>();
  // ...
}
```

## Route file structure

Follow the naming convention of existing routes:
- `_index.tsx` — index/landing
- `conversation.$id.tsx` — dynamic segment routes
- `api.conversation.$id.messages.tsx` — dot-separated API routes (no UI export needed)

Server-only helpers (DB calls, auth) live in `app/server/`. Shared utilities in `app/utils/`.

## Navigation

Use `useNavigate` for imperative navigation; use `<Link>` for declarative links. Never redirect from the client by manipulating `window.location`.

## Logging

Use `logger` from `~/server/utils/logger` — never `console.log` or `console.error`:
```ts
import { logger } from "~/server/utils/logger";

logger.logError(error, { method: "GET", path: "/route", duration: 0 });
```
