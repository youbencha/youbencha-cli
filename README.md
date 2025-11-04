# youBencha

A friendly, developer-first CLI framework for evaluating agentic coding tools.

## Prerequisites

- Node.js 20.0.0 or higher
- npm

## Installation

```bash
npm install
```

## Development

```bash
# Build the project
npm run build

# Run tests
npm test

# Lint code
npm run lint

# Format code
npm run format

# Check formatting
npm run format:check
```

## Project Structure

```text
youbencha/
├── src/
│   ├── cli/          # CLI commands and entry point
│   ├── core/         # Core orchestration logic
│   ├── adapters/     # Agent adapters (pluggable)
│   ├── evaluators/   # Evaluation plugins
│   ├── schemas/      # Zod schemas for validation
│   ├── reporters/    # Result reporters (JSON, Markdown)
│   └── lib/          # Shared utilities
├── tests/
│   ├── contract/     # Contract tests for interfaces
│   ├── integration/  # End-to-end tests
│   └── unit/         # Unit tests
└── specs/            # Feature specifications
```

## Usage

```bash
# Run an agent evaluation
yb run -c suite.yaml

# Generate a report
yb report results.json

# Suggest evaluators for a branch
yb suggest-eval --branch feature-branch
```

## Architecture

youBencha follows a pluggable architecture:

- **Agent-Agnostic**: Agent-specific logic isolated in adapters
- **Pluggable Evaluators**: Add new evaluators without core changes
- **Reproducible**: Complete execution context captured
- **youBencha Log Compliance**: Normalized logging format across agents

## License

MIT
