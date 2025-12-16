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
 * Represents an image found on a webpage
 */
interface ImageInfo {
  url: string
  width?: number
  height?: number
  alt?: string
  size?: number // File size in bytes
  area?: number // width * height for comparison
}

/**
 * Extracts text content from HTML string
 * Simple implementation that removes HTML tags and normalizes whitespace
 */
export function extractTextFromHTML(html: string): string {
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
 * Resolves a relative URL to an absolute URL based on a base URL
 */
function resolveUrl(url: string, baseUrl: string): string {
  try {
    return new URL(url, baseUrl).href
  } catch {
    return url
  }
}

/**
 * Extracts all images from HTML and returns their information
 */
function extractImagesFromHTML(html: string, baseUrl: string): ImageInfo[] {
  const images: ImageInfo[] = []
  const imgRegex = /<img[^>]+>/gi
  const matches = html.matchAll(imgRegex)

  for (const match of matches) {
    const imgTag = match[0]
    
    // Extract src attribute
    const srcMatch = imgTag.match(/src=["']([^"']+)["']/i)
    if (!srcMatch) continue
    
    const src = srcMatch[1]
    const absoluteUrl = resolveUrl(src, baseUrl)
    
    // Extract width and height attributes
    const widthMatch = imgTag.match(/width=["']?(\d+)["']?/i)
    const heightMatch = imgTag.match(/height=["']?(\d+)["']?/i)
    const altMatch = imgTag.match(/alt=["']([^"']*)["']/i)
    
    const width = widthMatch ? parseInt(widthMatch[1], 10) : undefined
    const height = heightMatch ? parseInt(heightMatch[1], 10) : undefined
    const alt = altMatch ? altMatch[1] : undefined
    
    const area = (width && height) ? width * height : undefined
    
    images.push({
      url: absoluteUrl,
      width,
      height,
      alt,
      area,
    })
  }
  
  return images
}

/**
 * Fetches an image and returns its size and base64 representation
 */
async function fetchImageData(imageUrl: string): Promise<{ size: number; base64: string; width?: number; height?: number }> {
  try {
    const response = await fetch(imageUrl)
    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.status}`)
    }
    
    const arrayBuffer = await response.arrayBuffer()
    const size = arrayBuffer.byteLength
    
    // Convert to base64
    const buffer = Buffer.from(arrayBuffer)
    const base64 = buffer.toString('base64')
    
    // Try to get content type
    const contentType = response.headers.get('content-type') || 'image/jpeg'
    
    // For now, we'll return the base64 with content type prefix
    // Note: Some LLM APIs may require different formats
    const dataUri = `data:${contentType};base64,${base64}`
    
    // Try to get dimensions from image (this would require image processing library)
    // For now, we'll rely on HTML attributes or skip dimension detection
    
    return {
      size,
      base64: dataUri,
    }
  } catch (error) {
    throw new Error(`Error fetching image ${imageUrl}: ${error}`)
  }
}

/**
 * Finds the largest image on a webpage and generates alt text using LLM vision
 */
export async function generateImageAltText(url: string, llmBaseUrl?: string) {
  // Fetch the webpage
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`)
  }
  const html = await response.text()
  
  // Extract all images
  const images = extractImagesFromHTML(html, url)
  
  if (images.length === 0) {
    throw new Error('No images found on the page')
  }
  
  // Find the largest image
  // Priority: area (width * height) > size > first image
  let largestImage: ImageInfo | null = null
  let maxArea = 0
  let maxSize = 0
  
  // First, try to find by area (dimensions)
  for (const img of images) {
    if (img.area && img.area > maxArea) {
      maxArea = img.area
      largestImage = img
    }
  }
  
  // If no dimensions available, fetch images to get their file sizes
  if (!largestImage || !largestImage.area) {
    for (const img of images) {
      try {
        const imageData = await fetchImageData(img.url)
        img.size = imageData.size
        
        if (imageData.size > maxSize) {
          maxSize = imageData.size
          largestImage = img
        }
      } catch (error) {
        console.warn(`Failed to fetch image ${img.url}:`, error)
        // Continue with other images
      }
    }
  }
  
  if (!largestImage) {
    throw new Error('Could not determine largest image')
  }
  
  // Fetch the largest image data
  const imageData = await fetchImageData(largestImage.url)
  
  // Use LLM vision API to describe the image
  const llmUrl = llmBaseUrl || 'http://192.168.1.61:1234/v1'
  const finalLlmUrl = llmUrl.endsWith('/v1') ? llmUrl : `${llmUrl}/v1`
  
  const systemPrompt = `You are an accessibility expert specializing in image description. Your task is to generate concise, descriptive alt-text for images that would be suitable for screen readers and accessibility purposes.

The alt-text should:
- Be 50-200 characters long
- Accurately describe the main subject and important details in the image
- Be clear and informative without being overly verbose
- Avoid redundant phrases like "image of" or "picture showing"
- Focus on what a visually impaired user would need to know
- Include context when relevant (e.g., "Chart showing sales data from 2020-2024")

Analyze the provided image carefully and generate appropriate alt-text. Return your response as JSON with "altText" and "description" fields.`

  const userPrompt = `Generate alt-text for this image from the webpage: ${url}

Image URL: ${largestImage.url}
${largestImage.alt ? `Existing alt attribute: ${largestImage.alt}` : 'No existing alt attribute'}

Please analyze the image and provide a JSON response with:
- "altText": A concise alt-text (50-200 characters)
- "description": A more detailed description (optional)`

  const responseFormat = {
    type: 'json_schema',
    json_schema: {
      name: 'image_alt_text_result',
      schema: {
        type: 'object',
        properties: {
          altText: {
            type: 'string',
            description: 'The alt-text suitable for this image (50-200 characters)',
          },
          description: {
            type: 'string',
            description: 'A more detailed description of the image (optional, for context)',
          },
        },
        required: ['altText'],
      },
    },
  }
  
  // Call vision API directly
  const llmResponse = await predictWithVision(
    finalLlmUrl,
    systemPrompt,
    userPrompt,
    imageData.base64,
    responseFormat
  )
  
  // Parse the JSON response
  let altText: string | undefined
  let description: string | undefined
  
  try {
    const parsed = JSON.parse(llmResponse.content)
    altText = parsed.altText
    description = parsed.description
  } catch {
    // If not JSON, try to extract from content
    altText = llmResponse.content
  }
  
  return {
    url,
    imageUrl: largestImage.url,
    altText: altText || largestImage.alt || 'Unable to generate alt-text',
    description: description || undefined,
    imageWidth: largestImage.width,
    imageHeight: largestImage.height,
    imageSize: imageData.size,
  }
}

/**
 * Makes a vision-capable LLM API call with image support
 * Supports OpenAI-compatible vision API format
 */
async function predictWithVision(
  llmBaseUrl: string,
  system: string,
  userText: string,
  imageDataUri: string,
  responseFormat?: any
): Promise<{ content: string }> {
  try {
    // Format messages for vision API (OpenAI-compatible format)
    const messages = [
      { role: 'system', content: system },
      {
        role: 'user',
        content: [
          { type: 'text', text: userText },
          {
            type: 'image_url',
            image_url: {
              url: imageDataUri, // data URI with base64 image
            },
          },
        ],
      },
    ]

    const response = await fetch(`${llmBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages,
        temperature: 0.7,
        response_format: responseFormat,
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`LLM Vision Error: ${response.status} ${response.statusText} - ${errorText}`)
    }

    const data = await response.json() as any
    return data.choices[0]?.message ?? { content: '' }
  } catch (error: any) {
    if (error.cause?.code === 'ECONNREFUSED') {
      throw new Error(`No LLM provider configured at ${llmBaseUrl}. Please start LM Studio or provide an API key.`)
    }
    throw error
  }
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

        const data = await response.json() as any
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

        const data = await response.json() as any
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
  async ({ system, user, tools, responseFormat }: any, ctx: any) => {
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
  const mode = process.argv[2]
  const url = process.argv[3]
  // Default to custom LLM URL, ensure it has /v1 suffix for LM Studio compatibility
  const llmBaseUrl = process.env.LLM_URL || 'http://192.168.1.61:1234'
  const llmUrl = llmBaseUrl.endsWith('/v1') ? llmBaseUrl : `${llmBaseUrl}/v1`

  // Support both: "bun run src/index.ts <url>" and "bun run src/index.ts --image <url>"
  const isImageMode = mode === '--image' || mode === '-i'
  const actualUrl = isImageMode ? url : mode

  if (!actualUrl) {
    console.error('Usage:')
    console.error('  Page alt-text: bun run src/index.ts <url>')
    console.error('  Image alt-text: bun run src/index.ts --image <url>')
    console.error('')
    console.error('Examples:')
    console.error('  bun run src/index.ts https://example.com')
    console.error('  bun run src/index.ts --image https://example.com')
    console.error('')
    console.error('Set LLM_URL environment variable to customize LLM server URL')
    process.exit(1)
  }

  try {
    if (isImageMode) {
      console.log(`Finding largest image and generating alt-text for: ${actualUrl}`)
      console.log(`Using LLM at: ${llmUrl}\n`)
      const result = await generateImageAltText(actualUrl, llmUrl)

      console.log('Result:')
      console.log('─'.repeat(50))
      console.log(`Page URL: ${result.url}`)
      console.log(`Image URL: ${result.imageUrl}`)
      if (result.imageWidth && result.imageHeight) {
        console.log(`Image dimensions: ${result.imageWidth}x${result.imageHeight}`)
      }
      if (result.imageSize) {
        console.log(`Image size: ${(result.imageSize / 1024).toFixed(2)} KB`)
      }
      console.log(`Alt-text: ${result.altText}`)
      if (result.description) {
        console.log(`Description: ${result.description}`)
      }
      console.log('─'.repeat(50))
    } else {
      console.log(`Scraping and analyzing: ${actualUrl}`)
      console.log(`Using LLM at: ${llmUrl}\n`)
      const result = await generateAltText(actualUrl, llmUrl)

      console.log('Result:')
      console.log('─'.repeat(50))
      console.log(`URL: ${result.url}`)
      console.log(`Topic: ${result.topic}`)
      console.log(`Alt-text: ${result.altText}`)
      console.log(`Fuel used: ${result.fuelUsed}`)
      console.log('─'.repeat(50))
    }
  } catch (error) {
    console.error('Error:', error)
    process.exit(1)
  }
}

// Run if executed directly
if (import.meta.main) {
  main()
}

