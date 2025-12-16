# Agent-99 URL Summarizer

An example project demonstrating [agent-99](https://github.com/tonioloewald/agent-99) - a type-safe-by-design, cost-limited virtual machine for safe execution of untrusted code.

This project scrapes a given URL and uses an LLM to generate a concise alt-text summary suitable for accessibility purposes (e.g., for link alt-text).

## Features

- **Web App Interface**: Simple, modern web UI for URL processing
- **LLM Settings**: Configurable LLM endpoint settings
- **Query History**: View all processed URLs with results displayed newest first
- **Web Scraping**: Uses agent-99's `httpFetch` atom to fetch webpage content
- **LLM Summarization**: Uses `llmPredictBattery` atom to generate accessible alt-text summaries
- **Type-Safe**: Built with TypeScript and agent-99's schema-based type system
- **Cost-Limited**: Execution is limited by fuel budget for safety

## Prerequisites

- [Bun](https://bun.sh/) runtime (recommended) or Node.js
- For local LLM support: [LM Studio](https://lmstudio.ai/) running on your configured endpoint

## Installation

```bash
# Install dependencies
bun install
```

## Usage

### Web App (Recommended)

Start the web server:

```bash
bun run dev
```

Then open your browser to `http://localhost:3000`

The web app provides:
- **Settings Panel**: Configure your LLM endpoint URL (collapsible)
- **URL Input**: Enter any URL to scan and generate alt-text
- **Results Display**: Newest results appear at the top
- **Query History**: View all previous queries with timestamps and metadata

### CLI Usage

You can still use the CLI interface:

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

### LLM Setup

The web app allows you to configure the LLM endpoint directly in the UI:

1. Click the "⚙️ LLM Settings" panel to expand it
2. Enter your LLM base URL (e.g., `http://localhost:1234/v1` or `http://192.168.1.61:1234/v1`)
3. The `/v1` suffix is automatically added if not present
4. Settings are saved to browser localStorage

**For Local Development with LM Studio:**

Follow these step-by-step instructions to set up a local LLM:

1. **Install LM Studio**
   - Download from [LM Studio](https://lmstudio.ai/)
   - Install and launch the application

2. **Download a Model**
   - In LM Studio, go to the "Search" tab
   - Search for and download a compatible model (recommended: models with 3B-7B parameters for faster responses)
   - Popular options: `llama-3.2-3b-instruct`, `phi-3-mini`, `mistral-7b-instruct`
   - Wait for the download to complete

3. **Load the Model**
   - Go to the "Chat" tab in LM Studio
   - Select your downloaded model from the dropdown
   - The model will load into memory (this may take a moment)

4. **Start the Local Server**
   - Click on the "Local Server" tab in LM Studio (or use the menu: View → Local Server)
   - Click "Start Server" button
   - The server will start on `http://localhost:1234` by default
   - You should see a green indicator showing the server is running
   - **Important**: Keep LM Studio running while using this application

5. **Verify Server is Running**
   - Open a browser and navigate to `http://localhost:1234/v1/models`
   - You should see a JSON response listing available models
   - If you see an error, the server is not running correctly

6. **Configure in the Application**
   - In the web app, click "⚙️ LLM Settings" to expand the settings panel
   - Enter your LLM base URL:
     - For local: `http://localhost:1234` (the `/v1` suffix is added automatically)
     - For remote: `http://192.168.1.61:1234` (if running on another machine)
   - Settings are saved to browser localStorage

**Troubleshooting LM Studio Setup:**

- **Connection Refused Error**: 
  - Ensure LM Studio is running and the server is started
  - Check that the server is running on the correct port (default: 1234)
  - Verify the URL in settings matches your server address

- **Server Not Starting**:
  - Make sure a model is loaded in the Chat tab
  - Try restarting LM Studio
  - Check if another application is using port 1234

- **Slow Responses**:
  - Use a smaller model (3B-7B parameters)
  - Ensure you have sufficient RAM (models need 4-8GB+ free)
  - Close other applications to free up resources

- **Testing the Connection**:
  ```bash
  # Test if server is responding
  curl http://localhost:1234/v1/models
  
  # Should return JSON with model information
  ```

**Default LLM URL:** `http://192.168.1.61:1234/v1` (can be changed in web app settings)

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
│   ├── index.ts          # Core implementation (generateAltText function)
│   ├── server.ts         # Web server and API endpoints
│   └── index.html        # Web app frontend
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

