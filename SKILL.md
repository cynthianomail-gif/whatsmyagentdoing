---
name: myoffice
description: Open a live office view of every Claude Code, Codex, Gemini CLI, Antigravity CLI, Copilot CLI, OMP, Pi, Kimi Code, DeepSeek Harness, Grok Build, OpenCode and Hermes agent on this machine — who is thinking, running a tool, writing a reply, waiting for the user, or done. Use when the user types /myoffice, asks what their agents are doing, wants to see all running sessions, or which agent is stuck or finished ("我的 agent 在幹嘛", "show my agents"). Also use when the user wants today's Teams / Outlook meetings put on the office's notice board as reminder notes ("抓今天的會議", "把會議貼到便條", "put my meetings on the board").
---

# myoffice

Start the dashboard. It serves a local page and opens it in the browser.
Run it **in the background** so it keeps running and doesn't block the chat
(this skill's base directory is shown above as "Base directory for this skill"):

```bash
node "<base directory>/bin/cli.js"
```

If it is already running, the same command just reopens the browser tab.

To **update** it — `/myoffice update`, or the user asks to update / upgrade —
run `node "<base directory>/bin/cli.js" --update` (not in the background),
report the version it printed, then start it again as above. The page also
shows the version in the corner and an "Update" button when a new one is out.

To **close** it — `/myoffice stop`, or the user asks to stop / close / shut the
office down — run (not in the background):

```bash
node "<base directory>/bin/cli.js" --stop
```

and say it's stopped.
Then tell the user, in one line, that the office is open at the printed URL.
If the output also says **"Update available: vA → vB"**, tell the user a new
version is out and offer to update it (`/myoffice update`, below).
Requires Node.js 18+; if `node` is missing, say so and stop.

Options the user may ask for:

- `--private` — hide prompts/replies, show status only (for screen sharing)
- `--hours 4` — only sessions active in the last 4 hours (default 24)
- `--port 5000` — different port (default 4545)
- `--stop` — stop the running dashboard
- `--json` — print a one-off snapshot instead of opening a page. Use this when
  the user asks in chat what their other agents are doing: run
  `node "<base directory>/bin/cli.js" --json --hours 2` and summarize by status.

## Today's meetings as notes

When the user asks for today's meetings on the board ("抓今天的會議"), the
office can't read Teams itself; you read them and hand them over:

1. Read today's events with the Microsoft 365 connector's calendar search
   (`outlook_calendar_search`: query `*`, from today 00:00 to tomorrow 00:00,
   order oldest, limit 25; fetch the next page while it gives `nextOffset`).
   No such connector, or it fails twice: say so and stop. Never ask for a password.
2. Write what it returned to a JSON file in your scratchpad, one entry per
   event, copying the fields as given (don't invent any):
   `{"meetings":[{"id":"…","subject":"…","start":{"dateTime":"…","timeZone":"…"},"end":{…},"location":"…","isAllDay":false,"isCancelled":false}]}`
3. Run (not in the background): `node "<base directory>/bin/cli.js" --add-meetings "<that file>"`
   and tell the user the line it printed.

Each meeting becomes a blue note (`📅 10:00–11:00 subject`) that reminds them
10 minutes before it starts: a notification, and a line at the top of the
office with "📌 Keep on top". Handing the same day over again updates the
notes instead of adding more; cancelled meetings come off the board; meetings
already over, and all-day ones, are left out. The board holds 12 notes.
Reminders only fire while the office is open in a browser tab (it is never
started automatically), and the first reminder the user sets asks the browser
for permission to show notifications.

If the user wants Claude Code permission prompts to show as "Waiting for you"
(Claude Code doesn't log them), offer `node "<base directory>/bin/cli.js" --install-hook`.
It adds one Notification hook to their Claude Code settings; `--uninstall-hook` removes it.
Ask before running it, since it changes their settings.

Everything is read locally from the agents' own session folders (`~/.claude/projects`,
`~/.codex/sessions`, `~/.gemini/tmp`, `~/.gemini/antigravity-cli`, `~/.copilot/session-state`, `~/.omp`, `~/.pi`, `~/.kimi-code`,
`~/.dsh`, `~/.grok`) and databases (`~/.local/share/opencode/opencode.db`, `%LOCALAPPDATA%\hermes\state.db`);
the server listens on 127.0.0.1 only and sends nothing anywhere.
