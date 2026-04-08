# Git Commit Security Validator

A pre-commit hook that uses a local LLM (Ollama) to analyze staged git changes and approve or block commits based on security rules.

## Tested Conditions

### Secret Detection
Blocks commits containing API keys, tokens, passwords, or other secrets.
![Secret Detection](./assets/secret_catch.gif)

### Code Quality Detection
Validates code syntax and quality before allowing commits.
![Code Quality](./assets/syntax_catch.gif)

### Branch Detection
Prevents direct commits to protected branches like main/master.
![Branch Detection](./assets/branch_catch.gif)

### Valid Commits
Allows commits when code passes all validation checks.
![Valid Commits](./assets/branch_checks.gif)

## Setup Instructions

### Prerequisites

1. **Install Node.js** (v14 or higher)
2. **Install Ollama** from https://ollama.ai
3. **Pull the LLM model**:
   ```bash
   ollama pull qwen2.5-coder:3b
   ```

### Installation

```bash
npm install
```

### Set Up as Git Pre-commit Hook

```bash
cp .git/hooks/pre-commit .git/hooks/pre-commit.bak 2>/dev/null || true
echo 'node index.js' > .git/hooks/pre-commit
chmod +x .git/hooks/pre-commit
```

### Usage

```bash
git add .
git commit -m "my changes"
```

To bypass validation:
```bash
git commit --no-verify -m "force commit"
```

## Configuration

Edit `rules.json` to customize security rules.
