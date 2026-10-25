---
name: ui-ux-expert
description: UI/UX conventions for this project — Tailwind, dark mode, mobile-first, accessibility, loading states, and component patterns
user-invokable: false
---

# UI/UX Expert

This project uses **Tailwind CSS** with a custom config, Inter font, `darkMode: "class"`, and a set of shared component classes defined in `app/tailwind.css`.

## Always use the shared component classes

Don't re-implement these from scratch — use the classes defined in `@layer components`:

| Class                | Use for                                            |
| -------------------- | -------------------------------------------------- |
| `.btn-primary`       | Primary CTA buttons (blue)                         |
| `.btn-secondary`     | Secondary/neutral buttons (gray)                   |
| `.input-modern`      | All text inputs (includes iOS zoom prevention)     |
| `.card`              | Surface containers                                 |
| `.message-user`      | User chat bubbles                                  |
| `.message-assistant` | Assistant chat bubbles                             |
| `.mobile-safe-area`  | Containers that need `env(safe-area-inset-bottom)` |

## Mobile-first layout

Design for mobile screens first, then scale up with `md:` breakpoints. Never write desktop-only styles without a mobile fallback.

```tsx
// Correct — mobile base, desktop modifier
<div className="p-3 md:p-6">
<span className="text-sm md:text-base">
<div className="w-6 h-6 md:w-8 md:h-8">
<div className="space-y-4 md:space-y-6">

// Wrong — no mobile consideration
<div className="p-6">
```

Key mobile patterns already established in the codebase:

- Sidebar uses `fixed` + `translate-x` slide animation; overlay backdrop covers content
- Mobile menu button is `md:hidden`; desktop sidebar is always visible
- Touch targets use `touch-manipulation` and `active:scale-95` (already in `.btn-primary`/`.btn-secondary`)
- Safe area: use `.mobile-safe-area` for bottom-anchored content on iOS

## Dark mode

`darkMode: "class"` is configured — dark mode activates when the `dark` class is on the `<html>` element (toggled by `ThemeToggle`).

Always pair light and dark variants on every color utility:

```tsx
// Correct
className = "bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100";
className = "border-gray-200 dark:border-gray-700";
className = "text-gray-500 dark:text-gray-400";

// Wrong — no dark variant
className = "bg-white text-gray-900";
```

Add `transition-colors duration-200` to elements that change color on theme switch.

## Brand gradient

The blue-to-purple gradient is the brand identity — use it consistently on avatars, icons, and accent elements:

```tsx
className = "bg-gradient-to-r from-blue-500 to-purple-600";
```

For gradient text (headings only):

```tsx
className =
  "bg-gradient-to-r from-gray-900 to-gray-600 dark:from-white dark:to-gray-300 bg-clip-text text-transparent";
```

## Loading states — all async operations must show feedback

Every async operation must have a visible loading indicator. Never leave the user guessing.

**Form submission** — use `useNavigation` from Remix:

```tsx
const navigation = useNavigation();
const isSubmitting = navigation.state === "submitting";

<button disabled={isSubmitting}>{isSubmitting ? "Sending..." : "Send"}</button>;
```

**Spinner** — use `animate-spin` on an SVG icon:

```tsx
<svg className="w-4 h-4 animate-spin" ...>
```

**Streaming/typing cursor** — use `animate-pulse` on an inline block:

```tsx
<span className="inline-block w-2 h-4 bg-blue-500 dark:bg-blue-400 ml-1 animate-pulse" />
```

**Transient status messages** (e.g. upload success) — use `animate-fade-out` and clear state after 2s:

```tsx
<div className="text-sm animate-fade-out text-green-600 dark:text-green-400">
  File uploaded successfully!
</div>
```

**Upload progress** — show a spinner + label while `uploading` state is true; show result message with `animate-fade-out` after.

## Error display

Show errors inline near the relevant action — never as alerts or raw stack traces. Use red tones with dark mode pairs:

```tsx
<p className="text-sm text-red-600 dark:text-red-400">{error}</p>
```

For persistent errors (e.g. failed chat response), render inline in the message list as a styled bubble. Include a short error message — never technical details.

## Accessibility

Every interactive element must be keyboard navigable and use semantic HTML.

- Icon-only buttons **must** have `aria-label`:
  ```tsx
  <button aria-label="Upload file">
    <svg .../>
  </button>
  ```
- Use semantic elements: `<header>`, `<main>`, `<h1>`–`<h3>`, `<button>` (not `<div onClick>`)
- All focusable elements must have a visible focus ring — the shared component classes already include `focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-gray-900`; don't suppress it with `outline-none` without a replacement
- Disabled form elements during submission: set `disabled={isSubmitting}` on inputs and buttons
- Use `text-base` on inputs to prevent iOS auto-zoom (already in `.input-modern`)

## Transitions

Use consistent durations:

- Color/opacity changes: `transition-colors duration-200` or `transition-all duration-200`
- Transforms (sidebar slide, scale): `transition-transform duration-300 ease-in-out`
- Don't animate layout properties (`width`, `height`) unless necessary — prefer `transform`

## Component structure

- One component per file in `app/components/`
- Define a props interface directly above the component function
- Use default exports for components
- Keep components under ~300 lines; split into sub-components when logic or JSX grows beyond that

```tsx
interface MyComponentProps {
  title: string;
  onClose: () => void;
}

export default function MyComponent({ title, onClose }: MyComponentProps) {
  ...
}
```

## Confirmation dialogs

Use inline confirmation (not browser `alert()` or a modal) for destructive actions. Show a small inline panel with "Confirm" and "Cancel" buttons, then execute on confirm. See the delete conversation pattern in `ConversationSidebar.tsx` as the reference implementation.
