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

This project demonstrates key agent-99 pipelines for building type-safe, secure agent workflows. The entire process follows agent-99's execution model:

### Execution Flow

1. **Content Extraction**: The webpage HTML is fetched and text content is extracted (outside the VM for simplicity)
2. **Pipeline Construction**: A type-safe pipeline is built using agent-99's builder API
3. **AST Compilation**: The pipeline is compiled to a JSON AST representation
4. **VM Execution**: The AST is executed in an isolated VM with explicit capabilities
5. **Result Extraction**: Structured output is returned with type validation

### Key Agent-99 Pipelines

The project uses several core agent-99 pipelines to build the workflow:

#### 1. **llmPredictBattery Pipeline**
The primary pipeline for LLM interactions. This atom:
- Makes type-safe LLM calls with structured input/output schemas
- Supports system prompts, user messages, and tool definitions
- Enforces JSON schema response formats for structured outputs
- Uses battery capabilities (local or remote LLM providers)

```167:205:src/index.ts
  const logic = b
    .llmPredictBattery({
      system: `You are an accessibility expert. Your task is to generate concise, descriptive alt-text that would be suitable for a link to a webpage. 
The alt-text should:
- Be 50-150 characters long
- Describe the main topic or purpose of the page
- Be clear and informative
- Avoid redundant phrases like "link to" or "page about"
- Focus on what the user would find on the page

You will receive webpage content (which may include HTML). Extract the meaningful text content and generate appropriate alt-text based on the page's main topic and purpose.`,
      user: `Generate alt-text for a link to this webpage: ${url}

Here is the extracted text content from the webpage:

${pageText.substring(0, 3000)}

Analyze this content and generate a concise alt-text summary suitable for accessibility purposes. Return your response as JSON with "altText" and "topic" fields.`,
      responseFormat: {
        type: 'json_schema',
        json_schema: {
          name: 'alt_text_result',
          schema: {
            type: 'object',
            properties: {
              altText: {
                type: 'string',
                description: 'The alt-text suitable for a link to this page (50-150 characters)',
              },
              topic: {
                type: 'string',
                description: 'Brief description of the page topic',
              },
            },
            required: ['altText', 'topic'],
          },
        },
      },
    })
```

#### 2. **Variable Management Pipelines**
Agent-99 provides type-safe variable operations:

- **`.as(alias)`**: Creates an alias for the current pipeline result, allowing reference in subsequent steps
- **`.varGet({ key })`**: Retrieves values from the variable store using dot-notation paths
- **`.varSet({ key, value })`**: Stores values in the variable store for later use

```206:212:src/index.ts
    .as('summary')
    .varGet({ key: 'summary.content' })
    .as('jsonContent')
    .jsonParse({ str: 'jsonContent' })
    .as('parsed')
    .varSet({ key: 'altText', value: 'parsed.altText' })
    .varSet({ key: 'topic', value: 'parsed.topic' })
```

#### 3. **Data Transformation Pipelines**
- **`.jsonParse({ str })`**: Parses JSON strings into structured objects with type validation
- Ensures data integrity throughout the pipeline

#### 4. **Output Schema Pipeline**
- **`.return(schema)`**: Defines the final output schema using `tosijs-schema`
- Provides runtime type validation and ensures the VM returns only the specified structure

```213:218:src/index.ts
    .return(
      s.object({
        altText: s.string,
        topic: s.string,
      })
    )
```

#### 5. **Additional Available Pipelines**
While not used in this example, agent-99 provides other powerful pipelines:

- **`httpFetch`**: Safe HTTP requests with capability-based security (can be used inside the VM)
- **`storeVectorize`**: Convert text to embeddings for semantic search
- **`storeSearch`**: Vector similarity search across stored embeddings
- **`defineAtom`**: Create custom atoms with custom schemas and capabilities

### Pipeline Execution Model

1. **Builder Pattern**: Pipelines are constructed using fluent builder API (`vm.A99`)
2. **AST Compilation**: `.toJSON()` compiles the pipeline to a JSON AST
3. **Isolated Execution**: `vm.run()` executes the AST in a stateless, isolated environment
4. **Capability-Based Security**: Only explicitly provided capabilities are available (LLM, HTTP, storage, etc.)
5. **Fuel Budget**: Execution is limited by fuel to prevent runaway processes
6. **Type Safety**: Input/output schemas are validated at runtime using `tosijs-schema`

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

