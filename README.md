# Agent-99 URL Summarizer

An example project demonstrating [agent-99](https://github.com/tonioloewald/agent-99) - a type-safe-by-design, cost-limited virtual machine for safe execution of untrusted code.

This project scrapes a given URL and uses an LLM to generate a concise alt-text summary suitable for accessibility purposes (e.g., for link alt-text).

## Features

- **Web Scraping**: Uses agent-99's `httpFetch` atom to fetch webpage content
- **LLM Summarization**: Uses `llmPredictBattery` atom to generate accessible alt-text summaries
- **Type-Safe**: Built with TypeScript and agent-99's schema-based type system
- **Cost-Limited**: Execution is limited by fuel budget for safety

## Prerequisites

- [Bun](https://bun.sh/) runtime (recommended) or Node.js
- For local LLM support: [LM Studio](https://lmstudio.ai/) running on `http://localhost:1234`

## Installation

```bash
# Install dependencies
bun install
```

## Usage

### Basic Usage

```bash
bun run src/index.ts <url>
```

Example:
```bash
bun run src/index.ts https://example.com
```

### Programmatic Usage

```typescript
import { generateAltText } from './src/index'

const result = await generateAltText('https://example.com')
console.log(result.altText) // "Example domain for documentation and testing"
```

## How It Works

1. **Fetch**: The agent uses `httpFetch` atom to retrieve the webpage content
2. **Process**: The response is passed to the LLM for analysis
3. **Generate**: The LLM generates structured output with:
   - `altText`: Concise description (50-150 characters) suitable for link alt-text
   - `topic`: Brief description of the page topic

The entire workflow is defined as a type-safe chain using agent-99's builder API, compiled to an AST, and executed in the isolated VM.

## Configuration

### LLM Setup (Local Development)

For local development, the project uses agent-99's battery capabilities which connect to LM Studio:

1. Install and run [LM Studio](https://lmstudio.ai/)
2. Start a local server on `http://localhost:1234`
3. Load a model in LM Studio
4. Run the script - it will automatically connect to the local LLM

### Production Setup

For production, you can replace the battery LLM with your own capability:

```typescript
const capabilities = {
  llmPredict: async (params) => {
    // Your LLM implementation (OpenAI, Anthropic, etc.)
    return await yourLLMService.generate(params)
  }
}
```

## Project Structure

```
.
├── src/
│   └── index.ts          # Main implementation
├── package.json          # Dependencies
├── tsconfig.json         # TypeScript configuration
├── README.md            # This file
├── TESTING.md           # Test instructions
└── CHANGELOG.md         # Change history
```

## Key Concepts

### Agent-99 Atoms

- **httpFetch**: Safe HTTP requests with capability-based security
- **llmPredictBattery**: LLM calls using local or remote models
- **return**: Defines the output schema

### Execution Model

- **AST-based**: Logic is compiled to JSON AST before execution
- **Isolated VM**: Each execution runs in a stateless, isolated environment
- **Fuel Budget**: Execution is limited by fuel to prevent runaway processes
- **Capabilities**: Security model where VM can only access what's explicitly provided

## Limitations

- The current implementation relies on the LLM's ability to extract meaningful content from HTML
- For better results, you may want to add HTML parsing/cleaning before LLM processing
- Local LLM requires LM Studio to be running for battery mode

## License

MIT

## References

- [agent-99 GitHub](https://github.com/tonioloewald/agent-99)
- [agent-99 Documentation](https://github.com/tonioloewald/agent-99#readme)

