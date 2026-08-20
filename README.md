# PromptGPT 🌲

A single-page AI chat interface built with HTML, Bootstrap 5, and vanilla JavaScript, groq API. No backend, no database, no build step — open `index.html` and it runs.

## Files

```
PromptGPT/
├── index.html          → page structure (Bootstrap + Google Fonts + highlight.js loaded from CDN)
├── style.css           → all styling (forest green / white theme, light + dark mode)
├── script.js           → all frontend logic (chat, modes, voice, image gen, code panel)
├── .gitignore           → project-level ignore rules (keeps .env and node_modules out of git)
├── README.md            → this file
└── server/               → backend proxy that keeps the API key off the frontend
    ├── server.js          → Express app; the ONLY place the real API key is used
    ├── package.json        → backend dependencies (express, cors, dotenv)
    ├── .env.example         → template for your API key — copy to .env and fill in
    └── .gitignore            → excludes server/.env and node_modules from git
```

## Features

- **Login gate** — asks for a name before entering. Not real authentication; the name lives only in memory for that browser tab.
- **No persistence** — nothing is written to `localStorage`, cookies, or any database. Refreshing the page resets everything (chats, mode usage, settings).
- **Three modes next to Send:**
  - **L1 · Chat** — general conversation (50 messages/session)
  - **M2 · Code** — coding assistant; when the reply contains code, it opens automatically in a Claude-style side panel with syntax highlighting, a Code/Preview toggle (HTML renders live in an iframe), and a copy button (25 messages/session)
  - **H3 · Image** — generates real images via [Pollinations.ai](https://pollinations.ai) (free, no API key required) (5 messages/session)
- **Resizable sidebar** — drag the handle on the sidebar's right edge.
- **Chat history** — searchable, exportable to `.txt`, deletable, all in the current session.
- **Voice**
  - 🎤 mic button: speech-to-text input (Web Speech API)
  - 🔊 button on AI replies: text-to-speech playback, with a voice picker and speed slider in Settings (uses whatever voices your OS/browser exposes)
- **Message tools**: copy, regenerate, edit-and-resend (on your own messages), stop-generation while a reply is streaming in.
- **Dark / light theme** toggle in Settings (light is the default).
- **Settings modal** only contains: System Prompt/Persona (Behavior), Dark mode (Appearance), and Voice settings — kept deliberately minimal.

## Text/code chat API

Chat and code modes call **your own backend proxy** at `POST {BACKEND_URL}/api/chat`, not Groq directly. The proxy (`server/server.js`) attaches the real Groq API key — read from the `GROQ_API_KEY` environment variable — and forwards the request to `https://api.groq.com/openai/v1/chat/completions`, then relays Groq's response back to the browser.

**The key never appears in:**
- Any HTML, CSS, or JavaScript file
- The browser's DevTools Network tab (only the proxy's own request to Groq carries it, on the server, not in the browser)
- Git history — `.env` is excluded via `.gitignore` (both `server/.gitignore` and the project root `.gitignore`); only `.env.example` (a template with no real value) is committed
- Any GitHub repo, as long as you never manually add `.env` to a commit

If you deploy the backend (Render, Railway, Fly.io, a VPS, or a serverless function), set `GROQ_API_KEY` as an environment variable in that platform's dashboard/CLI — never hardcode it in `server.js`.

## Image generation

The **H3 · Image** mode calls Pollinations.ai directly from the browser with no key:

```
https://image.pollinations.ai/prompt/{url-encoded prompt}?width=768&height=768&seed={random}&nologo=true
```

It's free and requires no signup, but it's a community-run service — no uptime guarantee, and quality is lower than paid options like DALL·E or Stable Diffusion. Swapping in a different image API only requires editing the `generateImage()` function in `script.js`.

## Customizing

- **Colors / theme**: all defined as CSS custom properties at the top of `style.css` under `[data-theme="light"]` and `[data-theme="dark"]`.
- **Font**: uses Fraunces + Source Serif 4 as free stand-ins for Copernicus (a commercial typeface not available on any CDN). To use real Copernicus, drop the font files in a `fonts/` folder and uncomment/edit the `@font-face` block at the top of `style.css`.
- **Models**: the dropdown in the top bar lists a few Groq models — edit the `<select id="modelSelect">` options in `index.html` to add/remove models.
- **Mode limits/prompts**: edit the `MODES` object near the top of `script.js` to change per-mode system prompts or message quotas.
- Image mode depends on a free third-party service with no SLA.
- Voice features depend on browser support (Web Speech API) — best in Chrome/Edge.
