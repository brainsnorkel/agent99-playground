import {
  AgentVM,
  batteries,
  storeVectorize,
  storeSearch,
  llmPredictBattery,
  A99,
  defineAtom,
} from 'agent-99'
import { s } from 'tosijs-schema'

/**
 * Extracts text content from HTML string
 * Simple implementation that removes HTML tags and normalizes whitespace
 */
function extractTextFromHTML(html: string): string {
  // Remove script and style elements
  let text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
  
  // Remove HTML tags
  text = text.replace(/<[^>]+>/g, ' ')
  
  // Decode HTML entities (basic)
  text = text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
  
  // Normalize whitespace
  text = text.replace(/\s+/g, ' ').trim()
  
  // Limit length to avoid token limits
  return text.substring(0, 8000)
}

/**
 * Creates custom capabilities with custom LLM URL
 */
function createCustomCapabilities(llmBaseUrl: string) {
  // Start with standard batteries
  const customCaps = { ...batteries }
  
  // Override LLM capability with custom URL
  customCaps.llm = {
    async predict(system: string, user: string, tools?: any[], responseFormat?: any) {
      try {
        const messages = [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ]

        const response = await fetch(`${llmBaseUrl}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages,
            temperature: 0.7,
            tools,
            response_format: responseFormat,
          }),
        })

        if (!response.ok) {
          throw new Error(`LLM Error: ${response.status} ${response.statusText}`)
        }

        const data = await response.json()
        return data.choices[0]?.message ?? { content: '' }
      } catch (error: any) {
        if (error.cause?.code === 'ECONNREFUSED') {
          throw new Error(`No LLM provider configured at ${llmBaseUrl}. Please start LM Studio or provide an API key.`)
        }
        throw error
      }
    },
    async embed(text: string) {
      try {
        const response = await fetch(`${llmBaseUrl}/embeddings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ input: text }),
        })

        if (!response.ok) {
          throw new Error(`Embedding Error: ${response.status}`)
        }

        const data = await response.json()
        return data.data[0]?.embedding ?? []
      } catch (error: any) {
        if (error.cause?.code === 'ECONNREFUSED') {
          throw new Error(`No LLM provider configured at ${llmBaseUrl}. Please start LM Studio or provide an API key.`)
        }
        throw error
      }
    },
  }
  
  return customCaps
}

/**
 * Creates a custom LLM atom with longer timeout for reasoning models
 */
const llmPredictBatteryLongTimeout = defineAtom(
  'llmPredictBattery',
  s.object({
    system: s.string,
    user: s.string,
    tools: s.array(s.any),
    responseFormat: s.any,
  }),
  s.object({
    content: s.string,
    tool_calls: s.array(s.any),
  }),
  async ({ system, user, tools, responseFormat }, ctx) => {
    const llmCap = ctx.capabilities.llm
    if (!llmCap?.predict) {
      throw new Error("Capability 'llm' missing or invalid.")
    }
    const resolvedSystem = (system && system !== '') ? system : 'You are a helpful agent.'
    const resolvedUser = user
    const resolvedTools = tools || undefined
    const resolvedFormat = responseFormat || undefined
    return llmCap.predict(resolvedSystem, resolvedUser, resolvedTools, resolvedFormat)
  },
  { docs: 'Generate completion using LLM battery (long timeout)', cost: 100, timeoutMs: 60000 } // 60 second timeout
)

/**
 * Creates a VM instance configured with battery capabilities for local development
 */
function createVM() {
  return new AgentVM({
    storeVectorize,
    storeSearch,
    llmPredictBattery: llmPredictBatteryLongTimeout, // Use custom atom with longer timeout
  })
}

/**
 * Generates alt-text summary for a given URL using agent-99
 * This demonstrates using httpFetch atom and llmPredictBattery atom in a chain
 * @param url - The URL to scrape and summarize
 * @param llmBaseUrl - Optional custom LLM base URL (defaults to localhost:1234)
 * @returns Object containing the alt-text and metadata
 */
export async function generateAltText(url: string, llmBaseUrl?: string) {
  // First, fetch the webpage content
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`)
  }
  const html = await response.text()
  const pageText = extractTextFromHTML(html)
  
  const vm = createVM()
  const b = vm.A99

  // Build the agent logic chain
  // Use LLM to generate alt-text from the extracted page content
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
    .as('summary')
    .varGet({ key: 'summary.content' })
    .as('jsonContent')
    .jsonParse({ str: 'jsonContent' })
    .as('parsed')
    .varSet({ key: 'altText', value: 'parsed.altText' })
    .varSet({ key: 'topic', value: 'parsed.topic' })
    .return(
      s.object({
        altText: s.string,
        topic: s.string,
      })
    )

  // Compile to AST
  const ast = logic.toJSON()

  // Execute in VM with capabilities
  // Note: The httpFetch response will be automatically passed to the LLM
  const customCapabilities = llmBaseUrl 
    ? createCustomCapabilities(llmBaseUrl)
    : batteries

  const result = await vm.run(
    ast,
    {}, // No input args needed since we're passing content directly
    {
      fuel: 10000, // Execution budget
      capabilities: customCapabilities, // Enable battery capabilities (LLM, etc.)
    }
  )

  // Parse the LLM response - it might be in content field or directly in result
  let altText = result.result?.altText
  let topic = result.result?.topic
  
  // If not found, try parsing from content field
  if (!altText && result.result?.summary?.content) {
    try {
      const parsed = JSON.parse(result.result.summary.content)
      altText = parsed.altText
      topic = parsed.topic
    } catch {
      // If not JSON, try to extract from content
      altText = result.result.summary.content
    }
  }
  
  // If still not found, check the raw result structure
  if (!altText && result.result) {
    console.log('Debug - result structure:', JSON.stringify(result.result, null, 2))
  }

  return {
    url,
    altText: altText || 'Unable to generate alt-text',
    topic: topic || 'Unable to determine topic',
    fuelUsed: result.fuelUsed,
  }
}

/**
 * Main entry point - CLI usage
 */
async function main() {
  const url = process.argv[2]
  // Default to custom LLM URL, ensure it has /v1 suffix for LM Studio compatibility
  const llmBaseUrl = process.env.LLM_URL || 'http://192.168.1.61:1234'
  const llmUrl = llmBaseUrl.endsWith('/v1') ? llmBaseUrl : `${llmBaseUrl}/v1`

  if (!url) {
    console.error('Usage: bun run src/index.ts <url>')
    console.error('Example: bun run src/index.ts https://example.com')
    console.error('Set LLM_URL environment variable to customize LLM server URL')
    process.exit(1)
  }

  try {
    console.log(`Scraping and analyzing: ${url}`)
    console.log(`Using LLM at: ${llmUrl}\n`)
    const result = await generateAltText(url, llmUrl)

    console.log('Result:')
    console.log('─'.repeat(50))
    console.log(`URL: ${result.url}`)
    console.log(`Topic: ${result.topic}`)
    console.log(`Alt-text: ${result.altText}`)
    console.log(`Fuel used: ${result.fuelUsed}`)
    console.log('─'.repeat(50))
  } catch (error) {
    console.error('Error:', error)
    process.exit(1)
  }
}

// Run if executed directly
if (import.meta.main) {
  main()
}

