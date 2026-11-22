# Claude Code setup

My Claude Code skills, plugins, agents, MCP servers and memory, so any computer
can have the same setup.

**Not in this repo:** the login (sign in on each computer), chat history, and caches.
Things tied to the claude.ai account (connectors like Krea, Gmail, Drive, and the
Anthropic skills) come back on their own when you sign in.

## Set up a new computer

1. Install Claude Code and sign in with the same account.
2. Install [Git](https://git-scm.com/download/win), [GitHub CLI](https://cli.github.com),
   [Node.js](https://nodejs.org) (for the radix, ark and shadcn MCP servers) and
   [Python 3](https://www.python.org/downloads/) (for Playwright).
   The installer adds [Bun](https://bun.sh) itself (for the reanimate skill).
   Optional: [uv](https://docs.astral.sh/uv/) for the Blender MCP server.
3. In PowerShell:

```powershell
gh auth login
```

```powershell
gh repo clone Bigadelsherif/claude-setup $HOME\claude-setup
```

```powershell
powershell -ExecutionPolicy Bypass -File $HOME\claude-setup\install.ps1
```

4. Quit and reopen Claude.

Project memory is matched by folder: it applies when the project sits at the same
place under your user folder (for example `Desktop\Jobs\Dar senosi`).

## Keep both computers in sync

On the computer where you added something new:

```powershell
powershell -ExecutionPolicy Bypass -File $HOME\claude-setup\export.ps1 -Push
```

On the other computer:

```powershell
git -C $HOME\claude-setup pull
```

```powershell
powershell -ExecutionPolicy Bypass -File $HOME\claude-setup\install.ps1
```

## What's inside

| Folder | What it is |
| --- | --- |
| `skills/` | Every skill from `~/.claude/skills` |
| `agents/` | Custom subagents |
| `local-plugins/` | Plugins that only existed on the first computer (helmy, bigaap) |
| `memory/` | Claude's per-project memory (`HOME` stands for your user folder) |
| `manifest.json` | Plugin marketplaces, enabled plugins, MCP servers |

## If plugins or MCP servers don't show up

The installer uses the `claude` command. If it wasn't found, run these once
`claude` works in PowerShell:

```powershell
claude plugin marketplace add HKUDS/CLI-Anything
```

```powershell
claude plugin marketplace add https://github.com/Motionsites-AI/claude-skill.git
```

```powershell
claude plugin marketplace add vercel/vercel-plugin
```

Then run `install.ps1` again; it installs the plugins and MCP servers.
