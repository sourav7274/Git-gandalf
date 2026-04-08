# Git Commit Security Validator

A pre-commit hook that uses a local LLM (Ollama) to analyze staged git changes and approve or block commits based on security rules.

## Features

- Detects secrets (API keys, tokens, passwords) in added lines
- Configurable security rules via `rules.json`
- Local LLM validation (no external APIs)
- Safe files bypass (index.js, rules.json, README.md)
- `--force` flag to bypass validation

## Running the Project

### Prerequisites

1. **Install Node.js** (v14 or higher)
2. **Install Ollama** from https://ollama.ai
3. **Pull the LLM model**:
   ```bash
   ollama pull qwen2.5-coder:3b
   ```

### Installation

```bash
# Install dependencies
npm install
```

### Run Directly

```bash
node index.js
```

### Set Up as Git Pre-commit Hook

```bash
# Backup existing hook if any
cp .git/hooks/pre-commit .git/hooks/pre-commit.bak 2>/dev/null || true

# Create the pre-commit hook
echo 'node index.js' > .git/hooks/pre-commit
chmod +x .git/hooks/pre-commit
```

### Usage

```bash
# Stage your changes
git add .

# Try to commit - the hook will analyze staged changes
git commit -m "my changes"

# If secrets/violations are found, commit will be blocked
# If passes, commit proceeds normally

# To bypass the validation (force commit)
git commit --no-verify -m "force commit"
# or
node index.js --force
```

## Features

```bash
# Stage files and commit
git add .
git commit -m "my changes"

# If violations found, commit is blocked
# If passes, commit proceeds

# Force bypass (skip LLM check)
git commit --no-verify -m "force commit"
# or
node index.js --force
```

## Configuration

Edit `rules.json` to customize security rules:

- **Never commit secrets** (CRITICAL) - API keys, tokens, passwords
- **Sensitive files must be ignored** (HIGH) - dependency files
- **Protected branches** (HIGH) - no direct commits to main/master
- **Large files** (MEDIUM) - use Git LFS
- **Security scanning expectation** (HIGH) - treat credential exposure as HIGH risk

## Flags

| Flag | Description |
|------|-------------|
| `--force` | Skip LLM validation and allow commit |

## Files

- `index.js` - Main entry point
- `rules.json` - Security rules configuration
- `.git/hooks/pre-commit` - Git hook (create if not exists)