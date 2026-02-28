# WizP

![Version](https://img.shields.io/npm/v/wizp)
![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)
![Node](https://img.shields.io/badge/Node.js-18%2B-green)
![Platforms](https://img.shields.io/badge/platform-Linux%20%7C%20macOS%20%7C%20Windows-brightgreen)

AI-powered Git workflow automation. Stage, commit, and push in one command.  
No Python. No pip. No SSL issues. Just Node.js.

---

## Install

```bash
npm install -g @wizdomic/wizp
```

---

## Setup

```bash
wizp setup
```

Choose a provider and paste your API key. Skippable — works without AI too.

| Provider  | Model                      | Get a key |
|-----------|----------------------------|-----------|
| OpenAI    | gpt-4o-mini                | https://platform.openai.com/api-keys |
| Anthropic | claude-3-5-sonnet-20241022 | https://console.anthropic.com/settings/keys |
| Gemini    | gemini-2.5-flash           | https://aistudio.google.com/app/apikey |

---

## Usage

```bash
wizp
```

```
Changes:
 M src/app.js

Files to add (. for all) [.]: .
✓ Staged: .

Generate commit message with AI? (y/n) [y]: y
ℹ Generating via anthropic...

  Add input validation to user registration

Use this? (y / r=regenerate / m=manual) [y]: y
✓ Committed: Add input validation to user registration

Push to remote? (y/n) [y]: y
✓ Pushed to origin/main
```

---

## Commands

| Command | Description |
|---------|-------------|
| `wizp` | Full workflow — add → commit → push |
| `wizp setup` | Configure AI provider and API key |
| `wizp upgrade` | Upgrade to latest version |
| `wizp uninstall` | Remove WizP from your system |
| `wizp --no-push` | Commit only, skip push |
| `wizp --no-ai` | Skip AI, type message manually |
| `wizp --force-push` | Force push ⚠️ destructive |
| `wizp --branch <n>` | Switch or create branch before committing |
| `wizp --help` | Show all commands |

---# gtxr
