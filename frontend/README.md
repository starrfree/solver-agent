# Solver Agent — Frontend

Angular 21 single-page app with a three-pane layout: conversations sidebar,
live solving session content pane (chat + ledger stream), and an artifacts
panel. See the [root README](../README.md) for the full architecture and
installation guide.

## Setup

```bash
cd frontend
npm install
# Backend must be running on http://localhost:3000
npm start                 # ng serve with proxy to /api
# or
npm run build             # production bundle in dist/
```

The dev server proxies `/api/**` to `http://localhost:3000` (see
[`proxy.conf.json`](./proxy.conf.json)).

## Architecture

- Standalone components, signals, new control flow (`@if`/`@for`).
- One signal-based store (`core/state/conversation-store.service.ts`) owns
  conversations, messages, ledger entries, and the SSE reducer.
- Routing: `/` (empty state) and `/c/:id` (conversation view).
- Server-Sent Events via native `EventSource`, see
  `core/api/stream.service.ts`. Reconnects with exponential backoff.
- Markdown rendered with `marked`, math with `katex`, code with
  `prismjs`, sanitized through `dompurify`.

## Theming

The app boots with `<html data-theme="dark">`. The
`ThemeService` reads `localStorage` and falls back to system preference
(`prefers-color-scheme`) on first load. CSS variables for each theme live
in [`src/styles/_tokens.scss`](./src/styles/_tokens.scss).
