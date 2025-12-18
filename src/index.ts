import {
  AgentVM,
  batteries,
  batteryAtoms,
  A99,
  defineAtom,
} from 'agent-99'
import { s } from 'tosijs-schema'
import { DEFAULT_LLM_URL } from './config'

/**
 * Debug flag - set AGENT99_DEBUG=1 or DEBUG=1 to enable verbose logging
 * This controls debug output from custom atoms and pipeline execution
 */
const DEBUG = process.env.AGENT99_DEBUG === '1' || process.env.DEBUG === '1'

/**
 * Debug logger - only logs when DEBUG flag is enabled
 */
function debugLog(...args: any[]) {
  if (DEBUG) {
    console.log(...args)
  }
}

/**
 * Debug warning - only logs when DEBUG flag is enabled
 */
function debugWarn(...args: any[]) {
  if (DEBUG) {
    console.warn(...args)
  }
}

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
  source?: string // Where the image was found: 'img', 'picture', 'css-background', 'data-bg'
}

/**
 * Reusable schema for ImageInfo objects
 * 
 * Note: tosijs-schema doesn't support optional/nullable types directly,
 * so we use s.any for fields that may be undefined. The TypeScript interface
 * above provides compile-time type safety, while this schema provides
 * runtime structure validation.
 * 
 * Expected types for s.any fields:
 * - width: number | undefined
 * - height: number | undefined  
 * - alt: string | undefined
 * - area: number | undefined (computed: width * height)
 * - size: number | undefined (file size in bytes)
 * - source: string | undefined ('img' | 'picture' | 'css-background' | 'data-bg')
 */
const imageInfoSchema = s.object({
  url: s.string,
  width: s.any,  // number | undefined
  height: s.any, // number | undefined
  alt: s.any,    // string | undefined
  area: s.any,   // number | undefined
  size: s.any,   // number | undefined
  source: s.any, // string | undefined
})

/**
 * Schema for image data returned from fetch operations
 */
const imageDataSchema = s.object({
  size: s.number,
  base64: s.string,
})

/**
 * Schema for scored candidate images (image + data + score)
 */
const scoredCandidateSchema = s.object({
  img: imageInfoSchema,
  imageData: imageDataSchema,
  score: s.number,
})

/**
 * Extracts text content from HTML string
 * Simple implementation that removes HTML tags and normalizes whitespace
 */
export function extractTextFromHTML(html: string): string {
  // Handle undefined/null input
  if (!html || typeof html !== 'string') {
    return ''
  }
  
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
 * Handles: <img> tags, <picture> elements, data URIs, and srcset attributes
 */
function extractImagesFromHTML(html: string, baseUrl: string): ImageInfo[] {
  const images: ImageInfo[] = []
  
  // Ensure html is a string
  if (!html || typeof html !== 'string') {
    debugWarn('extractImagesFromHTML: html is not a string, got:', typeof html, html)
    return []
  }
  
  // Extract <img> tags (including self-closing and with attributes)
  const imgRegex = /<img[^>]+>/gi
  const matches = Array.from(html.matchAll(imgRegex))
  
  // Debug: log how many img tags found
  if (matches.length === 0) {
    debugWarn('extractImagesFromHTML: No <img> tags found in HTML')
  } else {
    debugLog(`extractImagesFromHTML: Found ${matches.length} <img> tags`)
  }

  for (const match of matches) {
    const imgTag = match[0]
    
    // Extract src attribute (primary source)
    let srcMatch = imgTag.match(/src=["']([^"']+)["']/i)
    let src = srcMatch ? srcMatch[1] : null
    
    // If no src, try data-src (lazy loading)
    if (!src) {
      srcMatch = imgTag.match(/data-src=["']([^"']+)["']/i)
      src = srcMatch ? srcMatch[1] : null
    }
    
    // Decode HTML entities in src URL (e.g., &amp; -> &)
    if (src) {
      src = src.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    }
    
    // Skip data URIs that are too small (likely icons/sprites)
    if (src && src.startsWith('data:')) {
      // Only include data URIs if they seem substantial (more than just a small icon)
      if (src.length < 1000) continue // Skip small data URIs (likely icons)
    }
    
    if (!src) {
      // Debug: log when src is missing
      debugLog('extractImagesFromHTML: Skipping img tag with no src:', imgTag.substring(0, 100))
      continue
    }
    
    // Skip very small images (likely icons, sprites, or tracking pixels)
    // But be less aggressive - only skip if it's clearly a small icon/sprite
    const srcLower = src.toLowerCase()
    if (srcLower.includes('/icon/') || srcLower.includes('/sprite/') || 
        srcLower.includes('pixel.gif') || srcLower.includes('tracking.gif') ||
        srcLower.includes('1x1') || srcLower.includes('spacer.gif')) {
      continue
    }
    
    const absoluteUrl = resolveUrl(src, baseUrl)
    
    // Extract width and height attributes (handle formats like "400", "400px", width="400", etc.)
    const widthMatch = imgTag.match(/width\s*=\s*["']?(\d+)/i)
    const heightMatch = imgTag.match(/height\s*=\s*["']?(\d+)/i)
    const altMatch = imgTag.match(/alt=["']([^"']*)["']/i)
    
    // Also check for srcset (case-insensitive, handles both srcset and srcSet)
    const srcsetMatch = imgTag.match(/srcset=["']([^"']+)["']/i) || imgTag.match(/srcSet=["']([^"']+)["']/i)
    let largestSrcsetUrl = absoluteUrl
    if (srcsetMatch) {
      // Parse srcset: "url1 1x, url2 2x, url3 800w" format
      // Decode HTML entities in srcset
      const srcsetValue = srcsetMatch[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;/g, "'")
      const srcsetEntries = srcsetValue.split(',').map(s => s.trim())
      let largestSize = 0
      for (const entry of srcsetEntries) {
        const parts = entry.split(/\s+/)
        const url = parts[0]
        // Handle both "800w" and "2x" formats
        const sizeStr = parts[1] || ''
        let size = 0
        if (sizeStr.endsWith('w')) {
          size = parseInt(sizeStr) || 0
        } else if (sizeStr.endsWith('x')) {
          // For 2x, 3x etc, estimate size (2x = 2x the base, but we'll use the number)
          size = parseInt(sizeStr) * 100 || 0
        } else {
          size = parseInt(sizeStr) || 0
        }
        if (size > largestSize) {
          largestSize = size
          largestSrcsetUrl = resolveUrl(url, baseUrl)
        }
      }
    }
    
    const width = widthMatch ? parseInt(widthMatch[1], 10) : undefined
    const height = heightMatch ? parseInt(heightMatch[1], 10) : undefined
    const alt = altMatch ? altMatch[1] : undefined
    
    const area = (width && height) ? width * height : undefined
    
    // Use the largest srcset URL if available, otherwise use the src URL
    images.push({
      url: largestSrcsetUrl,
      width,
      height,
      alt,
      area,
    })
    
    // Debug: log extracted image
    debugLog(`extractImagesFromHTML: Extracted image: ${largestSrcsetUrl.substring(0, 80)}... (${width}x${height})`)
  }
  
  // Debug: log total images found
  debugLog(`extractImagesFromHTML: Extracted ${images.length} images from ${matches.length} img tags`)
  
  // Also extract images from <picture> elements
  const pictureRegex = /<picture[^>]*>([\s\S]*?)<\/picture>/gi
  const pictureMatches = html.matchAll(pictureRegex)
  
  for (const match of pictureMatches) {
    const pictureContent = match[1]
    // Find <img> inside <picture>
    const imgInPicture = pictureContent.match(/<img[^>]+>/i)
    if (imgInPicture) {
      const imgTag = imgInPicture[0]
      
      // Extract src or data-src
      let srcMatch = imgTag.match(/src=["']([^"']+)["']/i) || imgTag.match(/data-src=["']([^"']+)["']/i)
      if (!srcMatch) continue
      
      const src = srcMatch[1]
      if (src.startsWith('data:') && src.length < 1000) continue
      
      const absoluteUrl = resolveUrl(src, baseUrl)
      
      // Check <source> elements for larger images
      const sourceMatches = pictureContent.matchAll(/<source[^>]+>/gi)
      let bestSourceUrl = absoluteUrl
      let bestSize = 0
      
      for (const sourceMatch of sourceMatches) {
        const sourceTag = sourceMatch[0]
        const srcsetMatch = sourceTag.match(/srcset=["']([^"']+)["']/i)
        if (srcsetMatch) {
          const srcsetEntries = srcsetMatch[1].split(',').map(s => s.trim())
          for (const entry of srcsetEntries) {
            const parts = entry.split(/\s+/)
            const url = parts[0]
            const size = parts[1] ? parseInt(parts[1]) : 0
            if (size > bestSize) {
              bestSize = size
              bestSourceUrl = resolveUrl(url, baseUrl)
            }
          }
        }
      }
      
      const widthMatch = imgTag.match(/width\s*=\s*["']?(\d+)/i)
      const heightMatch = imgTag.match(/height\s*=\s*["']?(\d+)/i)
      const altMatch = imgTag.match(/alt=["']([^"']*)["']/i)
      
      const width = widthMatch ? parseInt(widthMatch[1], 10) : undefined
      const height = heightMatch ? parseInt(heightMatch[1], 10) : undefined
      const alt = altMatch ? altMatch[1] : undefined
      const area = (width && height) ? width * height : undefined
      
      images.push({
        url: bestSourceUrl,
        width,
        height,
        alt,
        area,
      })
    }
  }
  
  // Extract CSS background images from inline styles
  // Matches: style="background-image: url(...)" or style="background: url(...)"
  const bgImageCount = extractCSSBackgroundImages(html, baseUrl, images)
  if (bgImageCount > 0) {
    debugLog(`extractImagesFromHTML: Found ${bgImageCount} CSS background images`)
  }
  
  return images
}

/**
 * Extracts CSS background images from inline styles in HTML
 * Handles both background-image and background shorthand properties
 */
function extractCSSBackgroundImages(html: string, baseUrl: string, images: ImageInfo[]): number {
  let count = 0
  
  // Match any element with a style attribute containing background-image or background with url()
  // This handles: style="background-image: url(...)" and style="background: url(...)"
  const styleRegex = /style\s*=\s*["']([^"']*(?:background(?:-image)?)\s*:[^"']*url\s*\([^)]+\)[^"']*)["']/gi
  const styleMatches = Array.from(html.matchAll(styleRegex))
  
  for (const match of styleMatches) {
    const styleContent = match[1]
    
    // Extract all url() values from the style
    const urlRegex = /url\s*\(\s*["']?([^"')]+)["']?\s*\)/gi
    const urlMatches = Array.from(styleContent.matchAll(urlRegex))
    
    for (const urlMatch of urlMatches) {
      let src = urlMatch[1].trim()
      
      // Skip data URIs that are too small (gradients, small icons)
      if (src.startsWith('data:')) {
        if (src.length < 1000) continue
      }
      
      // Skip CSS gradients (linear-gradient, radial-gradient, etc.)
      if (src.includes('gradient')) continue
      
      // Decode HTML entities
      src = src.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;/g, "'")
      
      const absoluteUrl = resolveUrl(src, baseUrl)
      
      // Check if we already have this image
      if (images.some(img => img.url === absoluteUrl)) continue
      
      images.push({
        url: absoluteUrl,
        width: undefined,
        height: undefined,
        alt: undefined, // CSS backgrounds don't have alt text
        area: undefined,
        source: 'css-background', // Mark source for debugging
      })
      count++
      
      debugLog(`extractCSSBackgroundImages: Found background image: ${absoluteUrl.substring(0, 80)}...`)
    }
  }
  
  // Also look for data-bg attributes (common lazy loading pattern)
  const dataBgRegex = /data-bg\s*=\s*["']([^"']+)["']/gi
  const dataBgMatches = Array.from(html.matchAll(dataBgRegex))
  
  for (const match of dataBgMatches) {
    let src = match[1].trim()
    
    if (src.startsWith('data:') && src.length < 1000) continue
    
    src = src.replace(/&amp;/g, '&')
    const absoluteUrl = resolveUrl(src, baseUrl)
    
    if (images.some(img => img.url === absoluteUrl)) continue
    
    images.push({
      url: absoluteUrl,
      width: undefined,
      height: undefined,
      alt: undefined,
      area: undefined,
      source: 'data-bg',
    })
    count++
  }
  
  return count
}

/**
 * Fetches an image and returns its size and base64 representation
 * 
 * NOTE: This is a TEST UTILITY function that uses direct fetch() outside the VM.
 * For production use, prefer the `fetchImageData` atom which executes within
 * agent-99's capability-based security model.
 * 
 * This function is exported primarily for use in tests (see example.test.ts)
 * where direct image fetching is needed without setting up the full VM pipeline.
 * 
 * @param imageUrl - URL of the image to fetch
 * @returns Object with size (bytes), base64 data URI, and optional dimensions
 */
export async function fetchImageData(imageUrl: string): Promise<{ size: number; base64: string; width?: number; height?: number }> {
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
 * Filters images to those larger than 10x10 and limits to top candidates
 * Minimum size threshold: area > 100 or width > 10 and height > 10
 */
function filterCandidateImages(images: ImageInfo[], maxCandidates: number = 3): ImageInfo[] {
  // Filter to images larger than 10x10
  const candidates = images.filter(img => {
    // If we have area, use that (area > 100 = 10x10)
    if (img.area && img.area > 100) return true
    // If we have both width and height, check both are > 10
    if (img.width && img.height && img.width > 10 && img.height > 10) return true
    // If we only have width or height, check if it's > 10
    if (img.width && img.width > 10) return true
    if (img.height && img.height > 10) return true
    // If no dimensions, include it (we'll check file size later)
    if (!img.width && !img.height) return true
    return false
  })

  // Sort by area (descending) or width, then take top candidates
  const sorted = candidates.sort((a, b) => {
    if (a.area && b.area) return b.area - a.area
    if (a.area) return -1
    if (b.area) return 1
    if (a.width && b.width) return b.width - a.width
    if (a.width) return -1
    if (b.width) return 1
    return 0
  })

  return sorted.slice(0, maxCandidates)
}

/**
 * Finds the most interesting image on a webpage and generates alt text using LLM vision
 * Scores all candidate images for interestingness and selects the highest-scoring one
 * Can optionally use page context to improve image alt-text generation
 * 
 * Uses agent-99's VM execution model with full pipeline for all operations,
 * ensuring consistency with the rest of the codebase.
 */
export async function generateImageAltText(url: string, llmBaseUrl?: string, pageContext?: { altText: string; topic: string }) {
  const vm = createVM()
  const b = vm.A99
  
  // Build the complete pipeline within the VM
  const logic = b
      // Step 1: Fetch the webpage using httpFetch atom
      // httpFetch returns the text directly, not a response object
      .httpFetch({ url: A99.args('url') })
      .as('html')
    // Step 2: Extract images from HTML
    .extractImagesFromHTML({ 
      html: A99.args('html'), 
      baseUrl: A99.args('url') 
    })
    .as('images')
    // Step 3: Filter to candidate images
    .filterCandidateImages({ 
      images: A99.args('images'), 
      maxCandidates: 3 
    })
    .as('candidates')
    // Step 4: Process candidates (fetch and score in parallel)
    .processCandidateImages({
      candidates: A99.args('candidates'),
      pageContext: pageContext ? A99.args('pageContext') : undefined,
    })
    .as('scoredCandidates')
    // Step 5: Return scored candidates (we'll select best outside pipeline for now)
    .return(
      s.object({
        candidates: s.array(scoredCandidateSchema),
      })
    )
  
  // Compile to AST
  const ast = logic.toJSON()
  
  // Execute in VM with capabilities
  const llmUrl = llmBaseUrl || DEFAULT_LLM_URL
  const finalLlmUrl = llmUrl.endsWith('/v1') ? llmUrl : `${llmUrl}/v1`
  const customCapabilities = finalLlmUrl 
    ? createCustomCapabilities(finalLlmUrl)
    : batteries
  
  // Provide fetch capability for httpFetch atom
  const capabilitiesWithFetch = {
    ...customCapabilities,
    fetch: customCapabilities.fetch || batteries.fetch || fetch,
  }
  
  let pipelineResult
  try {
    pipelineResult = await vm.run(
      ast,
      { 
        url, 
        pageContext: pageContext || undefined 
      },
      {
        fuel: 50000, // Higher fuel for image processing
        capabilities: capabilitiesWithFetch,
      }
    )
  } catch (vmError: any) {
    debugWarn('VM execution failed:', vmError.message)
    throw vmError
  }
  
  const scoredCandidates = pipelineResult?.result?.candidates || []
  
  if (scoredCandidates.length === 0) {
    throw new Error('No candidate images found or processed')
  }
  
  // Select the most interesting image (highest score)
  const mostInteresting = scoredCandidates.reduce((best: any, current: any) => 
    current.score > best.score ? current : best
  )
  
  debugLog(`Selected most interesting image: ${mostInteresting.img.url} (score: ${mostInteresting.score})`)
  
  const imageData = mostInteresting.imageData
  const mostInterestingImage = mostInteresting.img
  
  // Step 6: Generate alt-text for the selected image using vision battery
  const altTextVm = createVM()
  const altTextB = altTextVm.A99
  
  const systemPrompt = `You are an accessibility expert specializing in image description. Your task is to generate concise, descriptive alt-text for images that would be suitable for screen readers and accessibility purposes.

The alt-text should:
- Be 50-200 characters long
- Accurately describe the main subject and important details in the image
- Be clear and informative without being overly verbose
- Avoid redundant phrases like "image of" or "picture showing"
- Focus on what a visually impaired user would need to know
- Include context when relevant (e.g., "Chart showing sales data from 2020-2024")

Analyze the provided image carefully and generate appropriate alt-text. Return your response as JSON with "altText" and "description" fields.`

  let userPrompt = `Generate alt-text for this image from the webpage: ${url}

Image URL: ${mostInterestingImage.url}
${mostInterestingImage.alt ? `Existing alt attribute: ${mostInterestingImage.alt}` : 'No existing alt attribute'}`

  // Add page context if provided to help with image description
  if (pageContext) {
    userPrompt += `

Page Context:
- Page Topic: ${pageContext.topic}
- Page Alt-Text: ${pageContext.altText}

Use this page context to better understand the image's role and relevance on the page.`
  }

  userPrompt += `

Please analyze the image and provide a JSON response with:
- "altText": A concise alt-text (50-200 characters) that considers the page context
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
  
  // Build the agent logic chain using vision battery within VM
  const altTextLogic = altTextB
    .llmVisionBattery({
      system: systemPrompt,
      userText: userPrompt,
      imageDataUri: imageData.base64,
      responseFormat,
    })
    .as('summary')
    .varGet({ key: 'summary.content' })
    .as('jsonContent')
    .jsonParse({ str: 'jsonContent' })
    .as('parsed')
    .varSet({ key: 'altText', value: 'parsed.altText' })
    .varSet({ key: 'description', value: 'parsed.description' })
    .return(
      s.object({
        altText: s.string,
        description: s.any, // Optional field - can be string or undefined
      })
    )
  
  // Compile to AST
  const altTextAst = altTextLogic.toJSON()
  
  // Execute in VM with capabilities
  const altTextCapabilities = finalLlmUrl 
    ? createCustomCapabilities(finalLlmUrl)
    : batteries
  
  let altTextVmResult
  let altText: string | undefined
  let description: string | undefined
  
  try {
    altTextVmResult = await altTextVm.run(
      altTextAst,
      {},
      {
        fuel: 10000,
        capabilities: altTextCapabilities,
      }
    )
    
    // Parse the VM result
    altText = altTextVmResult?.result?.altText
    description = altTextVmResult?.result?.description
    
    // If not found, try parsing from content field
    if (!altText && altTextVmResult?.result?.summary?.content) {
      try {
        const parsed = JSON.parse(altTextVmResult.result.summary.content)
        altText = parsed.altText
        description = parsed.description
      } catch {
        // If not JSON, try to extract from content
        altText = altTextVmResult.result.summary.content
      }
    }
  } catch (vmError: any) {
    debugWarn('VM execution failed for alt-text generation:', vmError.message)
    debugLog('VM error stack:', vmError.stack)
    // Fallback to empty values
    altText = undefined
    description = undefined
  }
  
  return {
    url,
    imageUrl: mostInterestingImage.url,
    altText: altText || mostInterestingImage.alt || 'Unable to generate alt-text',
    description: description || undefined,
    imageWidth: mostInterestingImage.width,
    imageHeight: mostInterestingImage.height,
    imageSize: imageData.size,
  }
}

/**
 * Generates both page and image alt-text in a single operation
 * Uses a complete VM pipeline for all operations, ensuring consistency
 * and following agent-99's "agents-as-data" principle
 */
export async function generateCombinedAltText(url: string, llmBaseUrl?: string) {
  const vm = createVM()
  const b = vm.A99
  
  // Build the complete pipeline within the VM
  const logic = b
    // Step 1: Fetch the webpage using httpFetch atom
    // httpFetch may return a Response object (when using custom fetch) or text directly
    .httpFetch({ url: A99.args('url') })
    .as('httpResult')
    // Step 1.5: Extract text from Response if needed (Response body can only be read once)
    // Use custom atom to handle both Response objects and strings
    .extractResponseText({ response: A99.args('httpResult') })
    .as('html')
    // Store HTML in variable store for validation and later use
    .varSet({ key: 'html', value: 'html' })
    // Step 2: Extract images and text in parallel (store both)
    // Get html from state (stored by .as('html') and .varSet)
    .varGet({ key: 'html' })
    .as('htmlValue')
    .extractImagesFromHTML({ 
      html: A99.args('htmlValue'), 
      baseUrl: A99.args('url') 
    })
    .as('images')
    .varGet({ key: 'html' })
    .as('htmlValue2')
    .htmlExtractText({ html: A99.args('htmlValue2') })
    .as('pageText')
    // Step 3: Store pageText for prompt construction (store the current result)
    .varSet({ key: 'pageText', value: 'pageText' })
    // Verify pageText was stored by getting it back
    .varGet({ key: 'pageText' })
    .as('pageTextVerify')
    // Step 4: Generate page alt-text and topic using LLM
    .buildUserPrompt({ url: A99.args('url') })
    .as('userPrompt')
    .varSet({ key: 'userPrompt', value: 'userPrompt' })
    .varGet({ key: 'userPrompt' })
    .as('userPromptValue')
    .llmPredictBattery({
      system: `You are an accessibility expert. Your task is to generate concise, descriptive alt-text that would be suitable for a link to a webpage. 
The alt-text should:
- Be 50-150 characters long
- Describe the main topic or purpose of the page
- Be clear and informative
- Avoid redundant phrases like "link to" or "page about"
- Focus on what the user would find on the page

You will receive webpage content (which may include HTML). Extract the meaningful text content and generate appropriate alt-text based on the page's main topic and purpose.`,
      user: A99.args('userPromptValue'),
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
    .varSet({ key: 'pageAltText', value: 'parsed.altText' })
    .varSet({ key: 'pageTopic', value: 'parsed.topic' })
    // Return page results and images for further processing
    .return(
      s.object({
        pageAltText: s.string,
        pageTopic: s.string,
        images: s.array(imageInfoSchema),
      })
    )
  
  // Compile to AST
  const ast = logic.toJSON()
  
  // Execute in VM with capabilities
  const llmUrl = llmBaseUrl || DEFAULT_LLM_URL
  const finalLlmUrl = llmUrl.endsWith('/v1') ? llmUrl : `${llmUrl}/v1`
  const customCapabilities = finalLlmUrl 
    ? createCustomCapabilities(finalLlmUrl)
    : batteries
  
  // Provide fetch capability for httpFetch atom
  const capabilitiesWithFetch = {
    ...customCapabilities,
    fetch: customCapabilities.fetch || batteries.fetch || fetch,
  }
  
  let pipelineResult
  let pageAltText: string | undefined
  let pageTopic: string | undefined
  let fuelUsed = 0 // Accumulate fuel from all VM runs
  let fetchError: FetchErrorInfo | undefined
  let llmError: LLMErrorInfo | undefined
  
  try {
    pipelineResult = await vm.run(
      ast,
      { url },
      {
        fuel: 50000, // Higher fuel for combined processing
        capabilities: capabilitiesWithFetch,
      }
    )
    
    fuelUsed += pipelineResult?.fuelUsed || 0
    pageAltText = pipelineResult?.result?.pageAltText
    pageTopic = pipelineResult?.result?.pageTopic
    const images = pipelineResult?.result?.images || []
    
    // Validate that we got meaningful results - check if HTML extraction succeeded
    const htmlContent = pipelineResult?.vars?.html || ''
    const pageTextContent = pipelineResult?.vars?.pageText || ''
    const responseObj = pipelineResult?.vars?.response
    
    // Debug: Log response structure
    if (responseObj) {
      debugLog('Response object keys:', Object.keys(responseObj))
      if (responseObj.text) {
        debugLog(`Response.text length: ${responseObj.text.length} chars`)
      } else {
        debugWarn('Response object exists but has no .text property')
        debugLog('Response object sample:', JSON.stringify(responseObj).substring(0, 200))
      }
    } else {
      debugWarn('No response object found in pipeline vars')
    }
    
    if (!htmlContent || htmlContent.trim().length === 0) {
      debugWarn('WARNING: No HTML content was fetched from the URL. The LLM response may be generic/hallucinated.')
      debugWarn('Debug - pipeline vars keys:', Object.keys(pipelineResult?.vars || {}))
    } else if (!pageTextContent || pageTextContent.trim().length === 0) {
      debugWarn('WARNING: HTML was fetched but no text could be extracted. The page may require JavaScript or have no text content.')
    }
    
    debugLog('Pipeline result - pageAltText:', pageAltText, 'pageTopic:', pageTopic)
    debugLog(`Found ${images.length} image(s) on the page`)
    if (htmlContent) {
      debugLog(`HTML content length: ${htmlContent.length} chars, extracted text length: ${pageTextContent.length} chars`)
    }
  } catch (vmError: any) {
    debugWarn('VM execution failed:', vmError.message)
    debugLog('VM error stack:', vmError.stack)
    
    // Check if this is a fetch error with detailed info
    if (vmError.fetchErrorInfo) {
      fetchError = vmError.fetchErrorInfo
      pageAltText = `Site could not be analyzed: ${fetchError!.errorMessage}`
      pageTopic = `Error: ${fetchError!.errorType}`
    } else if (vmError.llmErrorInfo) {
      // Check if this is an LLM error with detailed info
      llmError = vmError.llmErrorInfo
      pageAltText = `LLM error: ${llmError!.errorMessage}`
      pageTopic = `Error: ${llmError!.errorType}`
    } else {
      // Try to extract error info from the error message
      const errorMsg = vmError.message || String(vmError)
      if (errorMsg.includes('Site Analysis Failed:')) {
        // Extract error type from message
        pageAltText = errorMsg.split('\n')[0].replace('Site Analysis Failed: ', '')
        pageTopic = 'Site access error'
      } else if (errorMsg.includes('LLM Error:') || errorMsg.includes('LLM Connection Failed:')) {
        // Try to classify LLM error from message
        llmError = classifyLLMError(vmError, llmBaseUrl || DEFAULT_LLM_URL)
        pageAltText = `LLM error: ${llmError.errorMessage}`
        pageTopic = `Error: ${llmError.errorType}`
      } else {
        pageAltText = undefined
        pageTopic = undefined
      }
    }
    // Keep fuelUsed as accumulated (don't reset it)
  }
  
  // Step 5: Process images using VM pipeline (if images found)
  let imageResult = null
  const images = pipelineResult?.result?.images || []
  if (images.length > 0) {
    try {
      // Use VM pipeline for image processing
      const imageVm = createVM()
      const imageB = imageVm.A99
      
      const imageLogic = imageB
        // Filter candidates
        .filterCandidateImages({
          images: A99.args('images'),
          maxCandidates: 3,
        })
        .as('candidates')
        // Process candidates (fetch and score)
        .processCandidateImages({
          candidates: A99.args('candidates'),
          pageContext: pageAltText && pageTopic ? {
            altText: pageAltText,
            topic: pageTopic,
          } : undefined,
        })
        .as('scoredCandidates')
        // Store scoredCandidates as 'candidates' for return
        .varSet({ key: 'candidates', value: 'scoredCandidates' })
        // Return scored candidates
        .return(
          s.object({
            candidates: s.array(scoredCandidateSchema),
          })
        )
      
      const imageAst = imageLogic.toJSON()
      
      let imagePipelineResult
      try {
        imagePipelineResult = await imageVm.run(
          imageAst,
          { images },
          {
            fuel: 50000,
            capabilities: capabilitiesWithFetch,
          }
        )
        
        // Accumulate fuel from image processing pipeline
        fuelUsed += imagePipelineResult?.fuelUsed || 0
        
        const scoredCandidates = imagePipelineResult?.result?.candidates || []
        debugLog('Image pipeline result:', JSON.stringify(imagePipelineResult?.result || {}).substring(0, 500))
        debugLog('Scored candidates count:', scoredCandidates.length)
        
        if (scoredCandidates.length === 0) {
          debugLog('No candidate images processed')
        } else {
          debugLog('First scored candidate:', JSON.stringify(scoredCandidates[0] || {}).substring(0, 300))
          
          // Find the most interesting image - with safety check
          const validScoredCandidates = scoredCandidates.filter((c: any) => c && c.img && c.score !== undefined)
            if (validScoredCandidates.length === 0) {
              debugLog('No valid scored candidates with img and score')
            } else {
              const mostInteresting = validScoredCandidates.reduce((best: any, current: any) => 
                current.score > best.score ? current : best
              )
              
              debugLog(`Selected most interesting image: ${mostInteresting.img.url} (score: ${mostInteresting.score})`)
            
            const mostInterestingImage = mostInteresting.img
            const imageData = mostInteresting.imageData
            
            // Generate image alt-text using VM pipeline
            const altTextVm = createVM()
            const altTextB = altTextVm.A99
            
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

Image URL: ${mostInterestingImage.url}
${mostInterestingImage.alt ? `Existing alt attribute: ${mostInterestingImage.alt}` : 'No existing alt attribute'}

Page Context:
- Page Topic: ${pageTopic || 'Unknown'}
- Page Alt-Text: ${pageAltText || 'Unknown'}

Use this page context to better understand the image's role and relevance on the page.

Please analyze the image and provide a JSON response with:
- "altText": A concise alt-text (50-200 characters) that considers the page context
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
            
            const altTextLogic = altTextB
              .llmVisionBattery({
                system: systemPrompt,
                userText: userPrompt,
                imageDataUri: imageData.base64,
                responseFormat,
              })
              .as('summary')
              .varGet({ key: 'summary.content' })
              .as('jsonContent')
              .jsonParse({ str: 'jsonContent' })
              .as('parsed')
              .varSet({ key: 'altText', value: 'parsed.altText' })
              .varSet({ key: 'description', value: 'parsed.description' })
              .return(
                s.object({
                  altText: s.string,
                  description: s.any,
                })
              )
            
            const altTextAst = altTextLogic.toJSON()
            
            let imageAltText: string | undefined
            let imageDescription: string | undefined
            
            try {
              const altTextResult = await altTextVm.run(
                altTextAst,
                {},
                {
                  fuel: 10000,
                  capabilities: customCapabilities,
                }
              )
              
              // Accumulate fuel from alt-text generation pipeline
              fuelUsed += altTextResult?.fuelUsed || 0
              
              imageAltText = altTextResult?.result?.altText
              imageDescription = altTextResult?.result?.description
              
              if (!imageAltText && altTextResult?.result?.summary?.content) {
                try {
                  const parsed = JSON.parse(altTextResult.result.summary.content)
                  imageAltText = parsed.altText
                  imageDescription = parsed.description
                } catch {
                  imageAltText = altTextResult.result.summary.content
                }
              }
            } catch (vmError: any) {
              debugWarn('VM execution failed for image alt-text:', vmError.message)
              imageAltText = undefined
              imageDescription = undefined
            }
            
            imageResult = {
              imageUrl: mostInterestingImage.url,
              altText: imageAltText || mostInterestingImage.alt || 'Unable to generate alt-text',
              description: imageDescription || undefined,
              imageWidth: mostInterestingImage.width,
              imageHeight: mostInterestingImage.height,
              imageSize: imageData.size,
            }
          }
        }
      } catch (imagePipelineError: any) {
        debugWarn('Image pipeline failed:', imagePipelineError.message)
      }
    } catch (error: any) {
      debugWarn('Image processing failed:', error.message)
      debugLog('Error stack:', error.stack)
      debugLog('Error details:', error)
      // Don't silently fail - log the error but continue
      imageResult = null
    }
  } else {
    debugLog('No images found on the page')
  }
  
  // Ensure we have valid strings (not undefined or empty)
  const finalPageAltText = (pageAltText && typeof pageAltText === 'string' && pageAltText.trim()) 
    ? pageAltText.trim() 
    : 'Unable to generate alt-text'
  const finalPageTopic = (pageTopic && typeof pageTopic === 'string' && pageTopic.trim())
    ? pageTopic.trim()
    : 'Unable to determine topic'
  
  // Build result object - ensure all fields are explicitly set (not undefined)
  const finalResult: {
    url: string
    pageAltText: string
    pageTopic: string
    fuelUsed?: number
    imageUrl?: string
    imageAltText?: string
    imageDescription?: string
    imageWidth?: number
    imageHeight?: number
    imageSize?: number
    error?: FetchErrorInfo
    llmError?: LLMErrorInfo
  } = {
    url,
    pageAltText: finalPageAltText,
    pageTopic: finalPageTopic,
  }
  
  // Only add optional fields if they have values (to avoid undefined in JSON)
  if (fuelUsed !== undefined) {
    finalResult.fuelUsed = fuelUsed
  }
  if (fetchError) {
    finalResult.error = fetchError
  }
  if (llmError) {
    finalResult.llmError = llmError
  }
  if (imageResult?.imageUrl) {
    finalResult.imageUrl = imageResult.imageUrl
    if (imageResult.altText) finalResult.imageAltText = imageResult.altText
    if (imageResult.description) finalResult.imageDescription = imageResult.description
    if (imageResult.imageWidth !== undefined) finalResult.imageWidth = imageResult.imageWidth
    if (imageResult.imageHeight !== undefined) finalResult.imageHeight = imageResult.imageHeight
    if (imageResult.imageSize !== undefined) finalResult.imageSize = imageResult.imageSize
  }
  
  debugLog('Final result:', {
    url: finalResult.url,
    pageAltText: finalResult.pageAltText,
    pageTopic: finalResult.pageTopic,
    hasPageAltText: !!finalResult.pageAltText && finalResult.pageAltText !== 'Unable to generate alt-text',
    hasImageUrl: !!finalResult.imageUrl,
    hasImageAltText: !!finalResult.imageAltText,
    fullResultKeys: Object.keys(finalResult),
  })
  
  // Validate that we're returning the expected structure
  if (!finalResult.pageAltText || !finalResult.pageTopic) {
    debugWarn('ERROR: Final result missing required fields!', finalResult)
  }
  
  return finalResult
}

/**
 * Error information for sites that couldn't be analyzed
 */
export interface FetchErrorInfo {
  errorType: 'blocked' | 'not_found' | 'dns_error' | 'timeout' | 'connection_refused' | 'ssl_error' | 'http_error' | 'unknown'
  errorCode?: number
  errorMessage: string
  suggestion: string
}

/**
 * Error information for LLM connection/response issues
 */
export interface LLMErrorInfo {
  errorType: 'not_running' | 'no_model' | 'connection_refused' | 'timeout' | 'auth_failed' | 'endpoint_not_found' | 'rate_limited' | 'server_error' | 'unknown'
  errorCode?: number
  errorMessage: string
  suggestion: string
  llmUrl?: string
}

/**
 * Classifies LLM errors and returns descriptive error information
 */
function classifyLLMError(error: any, llmUrl: string, response?: Response, errorText?: string): LLMErrorInfo {
  const errorMessage = error?.message || String(error)
  const errorCode = error?.cause?.code || error?.code
  const status = response?.status
  
  // Check for "No models loaded" error
  if (errorText?.includes('No models loaded') || errorMessage.includes('No models loaded')) {
    return {
      errorType: 'no_model',
      errorMessage: 'No model loaded in LM Studio',
      suggestion: 'Open LM Studio, go to the Chat tab, select and load a model, then ensure the Local Server is running (View → Local Server).',
      llmUrl,
    }
  }
  
  // HTTP status code errors
  if (status === 401) {
    return {
      errorType: 'auth_failed',
      errorCode: 401,
      errorMessage: `Authentication failed for LLM server`,
      suggestion: `The LLM server at ${llmUrl} requires authentication. Check your API key or authentication settings.`,
      llmUrl,
    }
  }
  
  if (status === 404) {
    return {
      errorType: 'endpoint_not_found',
      errorCode: 404,
      errorMessage: `LLM endpoint not found`,
      suggestion: `The LLM server at ${llmUrl} does not have the /chat/completions endpoint. Verify the server URL is correct and supports OpenAI-compatible API.`,
      llmUrl,
    }
  }
  
  if (status === 429) {
    return {
      errorType: 'rate_limited',
      errorCode: 429,
      errorMessage: `Rate limit exceeded`,
      suggestion: 'The LLM server is receiving too many requests. Wait a moment and try again.',
      llmUrl,
    }
  }
  
  if (status && status >= 500) {
    return {
      errorType: 'server_error',
      errorCode: status,
      errorMessage: `LLM server error (${status})`,
      suggestion: `The LLM server at ${llmUrl} encountered an internal error. Check if the server is running properly and try again later.`,
      llmUrl,
    }
  }
  
  // Connection refused
  if (errorCode === 'ECONNREFUSED' || errorMessage.includes('ECONNREFUSED')) {
    return {
      errorType: 'connection_refused',
      errorMessage: `Cannot connect to LLM server at ${llmUrl}`,
      suggestion: 'Ensure LM Studio is running and the Local Server is started. Check that the server URL is correct (should be like http://localhost:1234/v1).',
      llmUrl,
    }
  }
  
  // DNS resolution failures
  if (errorCode === 'ENOTFOUND' || errorMessage.includes('ENOTFOUND') || errorMessage.includes('getaddrinfo')) {
    return {
      errorType: 'not_running',
      errorMessage: `Cannot resolve LLM server hostname`,
      suggestion: `The hostname in ${llmUrl} cannot be resolved. Check that the server URL is correct and your network connection is working.`,
      llmUrl,
    }
  }
  
  // Timeout errors
  if (errorCode === 'ETIMEDOUT' || errorCode === 'ESOCKETTIMEDOUT' || 
      errorMessage.includes('timeout') || errorMessage.includes('TIMEDOUT') ||
      error?.name === 'AbortError' || errorMessage.includes('aborted')) {
    return {
      errorType: 'timeout',
      errorMessage: `LLM request timed out`,
      suggestion: `The LLM server at ${llmUrl} did not respond within the timeout period. The server may be overloaded, slow, or not running.`,
      llmUrl,
    }
  }
  
  // Connection reset
  if (errorCode === 'ECONNRESET' || errorMessage.includes('ECONNRESET')) {
    return {
      errorType: 'connection_refused',
      errorMessage: `Connection was reset by LLM server`,
      suggestion: `The connection to ${llmUrl} was unexpectedly closed. The server may have crashed or restarted.`,
      llmUrl,
    }
  }
  
  // Generic fetch failures
  if (errorMessage.includes('fetch failed') || errorMessage.includes('Failed to fetch')) {
    return {
      errorType: 'not_running',
      errorMessage: `Network request to LLM server failed`,
      suggestion: `Unable to make a network request to ${llmUrl}. Check that the server is running and accessible.`,
      llmUrl,
    }
  }
  
  // Default unknown error
  return {
    errorType: 'unknown',
    errorMessage: errorMessage.substring(0, 200),
    suggestion: `An unexpected error occurred with the LLM server at ${llmUrl}. Check that the server is running and the URL is correct.`,
    llmUrl,
  }
}

/**
 * Classifies fetch errors and returns descriptive error information
 */
function classifyFetchError(error: any, url: string): FetchErrorInfo {
  const errorMessage = error?.message || String(error)
  const errorCode = error?.cause?.code || error?.code
  
  // DNS resolution failures
  if (errorCode === 'ENOTFOUND' || errorMessage.includes('ENOTFOUND') || errorMessage.includes('getaddrinfo')) {
    const hostname = new URL(url).hostname
    return {
      errorType: 'dns_error',
      errorMessage: `Domain '${hostname}' does not exist or cannot be resolved`,
      suggestion: 'Check if the URL is spelled correctly. The domain may not exist or may have expired.',
    }
  }
  
  // Connection refused
  if (errorCode === 'ECONNREFUSED' || errorMessage.includes('ECONNREFUSED')) {
    return {
      errorType: 'connection_refused',
      errorMessage: 'Connection refused by the server',
      suggestion: 'The server may be down or not accepting connections.',
    }
  }
  
  // Timeout errors
  if (errorCode === 'ETIMEDOUT' || errorCode === 'ESOCKETTIMEDOUT' || 
      errorMessage.includes('timeout') || errorMessage.includes('TIMEDOUT') ||
      error?.name === 'AbortError' || errorMessage.includes('aborted')) {
    return {
      errorType: 'timeout',
      errorMessage: 'Request timed out',
      suggestion: 'The server took too long to respond. It may be overloaded or the connection is slow.',
    }
  }
  
  // SSL/TLS errors
  if (errorCode === 'CERT_HAS_EXPIRED' || errorCode === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' ||
      errorMessage.includes('SSL') || errorMessage.includes('TLS') || errorMessage.includes('certificate')) {
    return {
      errorType: 'ssl_error',
      errorMessage: 'SSL/TLS certificate error',
      suggestion: 'The site has an invalid or expired SSL certificate.',
    }
  }
  
  // Connection reset
  if (errorCode === 'ECONNRESET' || errorMessage.includes('ECONNRESET')) {
    return {
      errorType: 'connection_refused',
      errorMessage: 'Connection was reset by the server',
      suggestion: 'The server unexpectedly closed the connection. It may be blocking automated requests.',
    }
  }
  
  // Generic fetch failures
  if (errorMessage.includes('fetch failed') || errorMessage.includes('Failed to fetch')) {
    return {
      errorType: 'unknown',
      errorMessage: 'Network request failed',
      suggestion: 'Check your network connection and verify the URL is accessible.',
    }
  }
  
  // Default unknown error
  return {
    errorType: 'unknown',
    errorMessage: errorMessage.substring(0, 200),
    suggestion: 'An unexpected error occurred. Check the URL and try again.',
  }
}

/**
 * Classifies HTTP response errors (non-2xx status codes)
 */
function classifyHttpError(response: Response, url: string): FetchErrorInfo {
  const status = response.status
  const hostname = new URL(url).hostname
  
  // Blocked/Forbidden responses
  if (status === 403) {
    return {
      errorType: 'blocked',
      errorCode: 403,
      errorMessage: `Access forbidden by ${hostname}`,
      suggestion: 'This site blocks automated access. It may have bot detection or require authentication.',
    }
  }
  
  // Unauthorized
  if (status === 401) {
    return {
      errorType: 'blocked',
      errorCode: 401,
      errorMessage: `Authentication required for ${hostname}`,
      suggestion: 'This site requires login or authentication to access.',
    }
  }
  
  // Legal/censorship blocks
  if (status === 451) {
    return {
      errorType: 'blocked',
      errorCode: 451,
      errorMessage: `Content unavailable for legal reasons on ${hostname}`,
      suggestion: 'This content is blocked for legal reasons in your region.',
    }
  }
  
  // Not found
  if (status === 404) {
    return {
      errorType: 'not_found',
      errorCode: 404,
      errorMessage: `Page not found on ${hostname}`,
      suggestion: 'The specific page does not exist. Check if the URL path is correct.',
    }
  }
  
  // Gone
  if (status === 410) {
    return {
      errorType: 'not_found',
      errorCode: 410,
      errorMessage: `Page has been permanently removed from ${hostname}`,
      suggestion: 'This content has been deleted and is no longer available.',
    }
  }
  
  // Rate limiting
  if (status === 429) {
    return {
      errorType: 'blocked',
      errorCode: 429,
      errorMessage: `Rate limited by ${hostname}`,
      suggestion: 'Too many requests. Wait a moment and try again.',
    }
  }
  
  // Server errors
  if (status >= 500) {
    return {
      errorType: 'http_error',
      errorCode: status,
      errorMessage: `Server error (${status}) from ${hostname}`,
      suggestion: 'The server is experiencing issues. Try again later.',
    }
  }
  
  // Other client errors
  if (status >= 400) {
    return {
      errorType: 'http_error',
      errorCode: status,
      errorMessage: `HTTP error ${status} from ${hostname}`,
      suggestion: 'The request could not be processed. Check the URL and try again.',
    }
  }
  
  // Redirect without following (shouldn't normally happen with fetch)
  if (status >= 300) {
    return {
      errorType: 'http_error',
      errorCode: status,
      errorMessage: `Unexpected redirect (${status}) from ${hostname}`,
      suggestion: 'The site returned a redirect that could not be followed.',
    }
  }
  
  return {
    errorType: 'unknown',
    errorCode: status,
    errorMessage: `Unexpected HTTP status ${status}`,
    suggestion: 'An unexpected response was received. Try again.',
  }
}

/**
 * Creates a fetch wrapper that provides descriptive error information
 * for sites that block access or have connectivity issues
 */
function createFetchWithErrorInfo(baseFetch: typeof globalThis.fetch = fetch) {
  return async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url
    
    try {
      const response = await baseFetch(input, {
        ...init,
        signal: init?.signal || AbortSignal.timeout(30000), // 30 second default timeout
      })
      
      // Check for error HTTP status codes
      if (!response.ok) {
        const errorInfo = classifyHttpError(response, url)
        const error = new Error(
          `Site Analysis Failed: ${errorInfo.errorMessage}\n\n` +
          `URL: ${url}\n` +
          `HTTP Status: ${response.status} ${response.statusText}\n\n` +
          `Reason: ${errorInfo.suggestion}`
        ) as Error & { fetchErrorInfo: FetchErrorInfo }
        error.fetchErrorInfo = errorInfo
        throw error
      }
      
      return response
    } catch (error: any) {
      // If we already classified it, re-throw
      if (error.fetchErrorInfo) {
        throw error
      }
      
      // Classify the error
      const errorInfo = classifyFetchError(error, url)
      const enhancedError = new Error(
        `Site Analysis Failed: ${errorInfo.errorMessage}\n\n` +
        `URL: ${url}\n\n` +
        `Reason: ${errorInfo.suggestion}`
      ) as Error & { fetchErrorInfo: FetchErrorInfo }
      enhancedError.fetchErrorInfo = errorInfo
      throw enhancedError
    }
  }
}

/**
 * Creates custom capabilities with custom LLM URL
 */
function createCustomCapabilities(llmBaseUrl: string) {
  // Start with standard batteries
  const customCaps = { ...batteries }
  
  // Add fetch wrapper with descriptive error messages
  customCaps.fetch = createFetchWithErrorInfo()
  
  // Helper to get available model from LM Studio
  async function getAvailableModel(): Promise<string | null> {
    try {
      const modelsResponse = await fetch(`${llmBaseUrl}/models`)
      if (modelsResponse.ok) {
        const modelsData = await modelsResponse.json() as any
        const models = modelsData.data || modelsData
        if (Array.isArray(models) && models.length > 0) {
          return models[0].id || models[0].name || null
        }
      }
    } catch {
      // Ignore errors, will fall back to not specifying model
    }
    return null
  }
  
  // Override LLM capability with custom URL
  customCaps.llm = {
    async predict(system: string, user: string, tools?: any[], responseFormat?: any) {
      try {
        const messages = [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ]

        // Try to get available model
        const model = await getAvailableModel()
        const requestBody: any = {
          messages,
          temperature: 0.7,
        }
        
        // Add model if available (LM Studio will auto-select if not specified, but some APIs require it)
        if (model) {
          requestBody.model = model
        }
        
        // Add optional parameters
        if (tools) {
          requestBody.tools = tools
        }
        if (responseFormat) {
          requestBody.response_format = responseFormat
        }

        const response = await fetch(`${llmBaseUrl}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
          signal: AbortSignal.timeout(60000), // 60 second timeout
        })

        if (!response.ok) {
          const errorText = await response.text()
          const errorInfo = classifyLLMError(null, llmBaseUrl, response, errorText)
          const error = new Error(
            `LLM Error: ${errorInfo.errorMessage}\n\n` +
            `Server: ${llmBaseUrl}\n` +
            `Reason: ${errorInfo.suggestion}`
          ) as Error & { llmErrorInfo: LLMErrorInfo }
          error.llmErrorInfo = errorInfo
          throw error
        }

        const data = await response.json() as any
        return data.choices[0]?.message ?? { content: '' }
      } catch (error: any) {
        // If we already classified it, re-throw
        if (error.llmErrorInfo) {
          throw error
        }
        
        // Classify the error
        const errorInfo = classifyLLMError(error, llmBaseUrl)
        const enhancedError = new Error(
          `LLM Error: ${errorInfo.errorMessage}\n\n` +
          `Server: ${llmBaseUrl}\n\n` +
          `Reason: ${errorInfo.suggestion}`
        ) as Error & { llmErrorInfo: LLMErrorInfo }
        enhancedError.llmErrorInfo = errorInfo
        throw enhancedError
      }
    },
    async predictWithVision(system: string, userText: string, imageDataUri: string, responseFormat?: any) {
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

        // Try to get available model
        const model = await getAvailableModel()
        const requestBody: any = {
          messages,
          temperature: 0.7,
        }
        
        // Add model if available
        if (model) {
          requestBody.model = model
        }
        
        // Add optional parameters
        if (responseFormat) {
          requestBody.response_format = responseFormat
        }

        const response = await fetch(`${llmBaseUrl}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
          signal: AbortSignal.timeout(120000), // 120 second timeout for vision (longer)
        })

        if (!response.ok) {
          const errorText = await response.text()
          const errorInfo = classifyLLMError(null, llmBaseUrl, response, errorText)
          const error = new Error(
            `LLM Vision Error: ${errorInfo.errorMessage}\n\n` +
            `Server: ${llmBaseUrl}\n` +
            `Reason: ${errorInfo.suggestion}`
          ) as Error & { llmErrorInfo: LLMErrorInfo }
          error.llmErrorInfo = errorInfo
          throw error
        }

        const data = await response.json() as any
        return data.choices[0]?.message ?? { content: '' }
      } catch (error: any) {
        // If we already classified it, re-throw
        if (error.llmErrorInfo) {
          throw error
        }
        
        // Classify the error
        const errorInfo = classifyLLMError(error, llmBaseUrl)
        const enhancedError = new Error(
          `LLM Vision Error: ${errorInfo.errorMessage}\n\n` +
          `Server: ${llmBaseUrl}\n\n` +
          `Reason: ${errorInfo.suggestion}`
        ) as Error & { llmErrorInfo: LLMErrorInfo }
        enhancedError.llmErrorInfo = errorInfo
        throw enhancedError
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
 * Custom atom for extracting text from HTTP response
 * Extracts the .text property from a response object
 */
const extractResponseText = defineAtom(
  'extractResponseText',
  s.object({ response: s.any }), // Accept response object as parameter
  s.string,
  async ({ response }: { response: any }, ctx: any) => {
    // Debug: Log what we received and context state
    debugLog('extractResponseText: Input response type:', typeof response)
    debugLog('extractResponseText: Context state keys:', Object.keys(ctx.state || {}))
    debugLog('extractResponseText: Context vars keys:', Object.keys(ctx.vars || {}))
    
    // Handle argument references - resolve from state/vars/args
    let actualResponse = response
    if (response && typeof response === 'object' && '$kind' in response && response.$kind === 'arg') {
      const path = response.path
      debugLog('extractResponseText: Got argument reference, resolving. Path:', path)
      // Try args first (for direct function arguments), then state (for .as() results), then vars
      actualResponse = ctx.args?.[path] ?? ctx.state?.[path] ?? ctx.vars?.[path]
      debugLog('extractResponseText: Resolved from:', 
        ctx.args?.[path] !== undefined ? 'args' : 
        ctx.state?.[path] !== undefined ? 'state' : 
        ctx.vars?.[path] !== undefined ? 'vars' : 'none')
      debugLog('extractResponseText: Resolved response type:', typeof actualResponse)
    }
    
    // Handle different response formats
    if (typeof actualResponse === 'string') {
      debugLog(`extractResponseText: Response is already a string, length: ${actualResponse.length} chars`)
      return actualResponse
    } else if (actualResponse && typeof actualResponse === 'object') {
      // Check if it's a Response object with .text() method
      if ('text' in actualResponse && typeof actualResponse.text === 'function') {
        debugLog('extractResponseText: Found Response object with .text() method, calling it')
        try {
          const text = await actualResponse.text()
          debugLog(`extractResponseText: Got text from Response, length: ${text.length} chars`)
          return text
        } catch (e: any) {
          debugWarn('extractResponseText: Error calling .text():', e.message)
          return ''
        }
      } else if ('text' in actualResponse && typeof actualResponse.text === 'string') {
        debugLog(`extractResponseText: Extracted text property, length: ${actualResponse.text.length} chars`)
        return actualResponse.text
      } else if ('content' in actualResponse && typeof actualResponse.content === 'string') {
        debugLog(`extractResponseText: Extracted content, length: ${actualResponse.content.length} chars`)
        return actualResponse.content
      } else if ('body' in actualResponse && typeof actualResponse.body === 'string') {
        debugLog(`extractResponseText: Extracted body, length: ${actualResponse.body.length} chars`)
        return actualResponse.body
      } else {
        debugWarn('extractResponseText: Response object has no extractable text property')
        debugWarn('extractResponseText: Response keys:', Object.keys(actualResponse || {}))
        // Try to stringify and see what we have
        try {
          debugLog('extractResponseText: Response sample:', JSON.stringify(actualResponse).substring(0, 500))
        } catch { /* ignore */ }
        return ''
      }
    }
    debugWarn('extractResponseText: Invalid response type:', typeof actualResponse, 'value:', actualResponse)
    return ''
  },
  { docs: 'Extract text content from HTTP response object (handles Response objects and strings)', cost: 1 }
)

/**
 * Custom atom for extracting text from HTML
 * This keeps HTML processing within the VM execution model
 */
const htmlExtractText = defineAtom(
  'htmlExtractText',
  s.object({ html: s.string }),
  s.string,
  async ({ html }: { html: string }, ctx: any) => {
    // Debug: Log HTML input and context
    debugLog('htmlExtractText: Input html type:', typeof html)
    debugLog('htmlExtractText: Context state keys:', Object.keys(ctx.state || {}))
    debugLog('htmlExtractText: Context vars keys:', Object.keys(ctx.vars || {}))
    
    // Handle argument references - resolve from args/state/vars
    let actualHtml: any = html
    if (html && typeof html === 'object' && '$kind' in html && (html as any).$kind === 'arg') {
      const path = (html as any).path
      debugLog('htmlExtractText: Got argument reference, resolving. Path:', path)
      // Try args first, then state (for .as() results), then vars
      actualHtml = ctx.args?.[path] ?? ctx.state?.[path] ?? ctx.vars?.[path]
      debugLog('htmlExtractText: Resolved from:', 
        ctx.args?.[path] !== undefined ? 'args' : 
        ctx.state?.[path] !== undefined ? 'state' : 
        ctx.vars?.[path] !== undefined ? 'vars' : 'none')
      debugLog('htmlExtractText: Resolved HTML type:', typeof actualHtml,
        typeof actualHtml === 'string' ? `length: ${actualHtml.length}` : '')
    }
    
    // Handle Response objects that weren't properly extracted
    if (actualHtml && typeof actualHtml === 'object') {
      debugLog('htmlExtractText: Resolved HTML is object, keys:', Object.keys(actualHtml))
      if ('text' in actualHtml && typeof actualHtml.text === 'function') {
        debugWarn('htmlExtractText: ERROR - Found Response object! Should have been extracted by extractResponseText')
        return ''
      } else if ('text' in actualHtml && typeof actualHtml.text === 'string') {
        actualHtml = actualHtml.text
      }
    }
    
    // Fallback: try to get from context directly
    if (!actualHtml || (typeof actualHtml === 'string' && actualHtml.length === 0)) {
      debugLog('htmlExtractText: Trying fallback from context...')
      const fallback = ctx.state?.html ?? ctx.vars?.html ?? ctx.state?.htmlValue ?? ctx.vars?.htmlValue
      if (typeof fallback === 'string' && fallback.length > 0) {
        actualHtml = fallback
        debugLog('htmlExtractText: Got HTML from fallback, length:', actualHtml.length)
      }
    }
    
    if (!actualHtml) {
      debugWarn('htmlExtractText: No HTML content after all resolution attempts')
      return ''
    }
    
    if (typeof actualHtml !== 'string') {
      debugWarn('htmlExtractText: HTML is not a string, converting. Type:', typeof actualHtml)
      actualHtml = String(actualHtml)
    }
    
    if (actualHtml.length === 0) {
      debugWarn('htmlExtractText: Received empty HTML string')
      return ''
    }
    
    debugLog(`htmlExtractText: Processing HTML, length: ${actualHtml.length} chars`)
    return extractTextFromHTML(actualHtml)
  },
  { docs: 'Extract text content from HTML string', cost: 1 }
)

/**
 * Custom atom for extracting images from HTML
 * Returns array of image information with URLs, dimensions, and metadata
 */
const extractImagesFromHTMLAtom = defineAtom(
  'extractImagesFromHTML',
  s.object({ html: s.string, baseUrl: s.string }),
  s.array(imageInfoSchema),
  async ({ html, baseUrl }: { html: string; baseUrl: string }, ctx: any) => {
    // Debug: Log context state
    debugLog('extractImagesFromHTMLAtom: Input html type:', typeof html)
    debugLog('extractImagesFromHTMLAtom: Context state keys:', Object.keys(ctx.state || {}))
    debugLog('extractImagesFromHTMLAtom: Context vars keys:', Object.keys(ctx.vars || {}))
    
    // Ensure html is a string - handle cases where it might be an object or undefined
    let htmlString: string = ''
    
    // Handle argument references - resolve from args/state/vars
    let actualHtml: any = html
    if (html && typeof html === 'object' && html !== null && '$kind' in html && html.$kind === 'arg') {
      const path = (html as any).path
      debugLog('extractImagesFromHTMLAtom: Got argument reference, resolving. Path:', path)
      // Try args first, then state (for .as() results), then vars
      actualHtml = ctx.args?.[path] ?? ctx.state?.[path] ?? ctx.vars?.[path]
      debugLog('extractImagesFromHTMLAtom: Resolved from:', 
        ctx.args?.[path] !== undefined ? 'args' : 
        ctx.state?.[path] !== undefined ? 'state' : 
        ctx.vars?.[path] !== undefined ? 'vars' : 'none')
      debugLog('extractImagesFromHTMLAtom: Resolved HTML type:', typeof actualHtml, 
        typeof actualHtml === 'string' ? `length: ${actualHtml.length}` : '')
    }
    
    // If we have a string, use it directly
    if (typeof actualHtml === 'string' && actualHtml.length > 0) {
      htmlString = actualHtml
      debugLog('extractImagesFromHTMLAtom: Using resolved string, length:', htmlString.length)
    } else if (actualHtml && typeof actualHtml === 'object') {
      // Handle Response objects or objects with text property
      debugLog('extractImagesFromHTMLAtom: Resolved HTML is object, keys:', Object.keys(actualHtml))
      if ('text' in actualHtml && typeof actualHtml.text === 'function') {
        debugWarn('extractImagesFromHTMLAtom: ERROR - Found Response object! Should have been extracted by extractResponseText')
        return []
      } else if ('text' in actualHtml && typeof actualHtml.text === 'string') {
        htmlString = actualHtml.text
      } else if ('content' in actualHtml && typeof actualHtml.content === 'string') {
        htmlString = actualHtml.content
      }
    }
    
    // Fallback: try to get from context directly
    if (!htmlString || htmlString.length === 0) {
      debugLog('extractImagesFromHTMLAtom: Trying fallback from context...')
      const fallback = ctx.state?.html ?? ctx.vars?.html ?? ctx.state?.htmlValue ?? ctx.vars?.htmlValue
      if (typeof fallback === 'string' && fallback.length > 0) {
        htmlString = fallback
        debugLog('extractImagesFromHTMLAtom: Got HTML from fallback, length:', htmlString.length)
      }
    }
    
    // Resolve baseUrl similarly
    let baseUrlString: string = ''
    if (typeof baseUrl === 'string' && baseUrl.length > 0) {
      baseUrlString = baseUrl
    } else if (baseUrl && typeof baseUrl === 'object' && '$kind' in baseUrl && baseUrl.$kind === 'arg') {
      const path = (baseUrl as any).path
      baseUrlString = ctx.args?.[path] ?? ctx.state?.[path] ?? ctx.vars?.[path] ?? ''
    }
    if (!baseUrlString) {
      baseUrlString = ctx.args?.url ?? ctx.state?.url ?? ctx.vars?.url ?? ''
    }
    
    // Final validation
    if (!htmlString || htmlString.length === 0) {
      debugWarn('extractImagesFromHTMLAtom: No HTML content provided after all resolution attempts')
      debugLog('extractImagesFromHTMLAtom: Available state:', JSON.stringify(Object.keys(ctx.state || {})))
      debugLog('extractImagesFromHTMLAtom: Available vars:', JSON.stringify(Object.keys(ctx.vars || {})))
      return []
    }
    
    debugLog(`extractImagesFromHTMLAtom: Processing HTML, length: ${htmlString.length}, baseUrl: ${baseUrlString}`)
    return extractImagesFromHTML(htmlString, baseUrlString)
  },
  { docs: 'Extract image information from HTML string', cost: 5 }
)

/**
 * Custom atom for filtering candidate images
 * Filters to images larger than 10x10 and limits to top candidates
 */
const filterCandidateImagesAtom = defineAtom(
  'filterCandidateImages',
  s.object({ 
    images: s.array(imageInfoSchema),
    maxCandidates: s.any  // number | undefined - controls max images to return
  }),
  s.array(imageInfoSchema),
  async ({ images, maxCandidates = 3 }: { images: ImageInfo[]; maxCandidates?: number }, ctx: any) => {
    // Resolve argument references (check args first for values passed to vm.run())
    let actualImages = images
    if (images && typeof images === 'object' && '$kind' in images && images.$kind === 'arg') {
      debugLog('filterCandidateImages: Resolving images. Path:', images.path)
      actualImages = ctx.args?.[images.path] || ctx.state?.[images.path] || ctx.vars?.[images.path] || []
      debugLog('filterCandidateImages: Resolved to array of length:', actualImages?.length || 0)
    }
    
    if (!Array.isArray(actualImages)) {
      debugWarn('filterCandidateImages: images is not an array:', typeof actualImages)
      return []
    }
    
    return filterCandidateImages(actualImages, maxCandidates)
  },
  { docs: 'Filter images to candidates larger than 10x10', cost: 1 }
)

/**
 * Custom atom for constructing LLM user prompt from URL and page text
 * This keeps prompt construction within the VM execution model
 * Takes URL as parameter, uses current result (pageText) from pipeline
 */
const buildUserPrompt = defineAtom(
  'buildUserPrompt',
  s.object({ url: s.string }),
  s.string,
  async ({ url }: { url: string }, ctx: any) => {
    // Resolve URL argument reference (check args first, then state/vars)
    let resolvedUrl = url
    if (url && typeof url === 'object' && '$kind' in url && url.$kind === 'arg') {
      resolvedUrl = ctx.args?.[url.path] || ctx.state?.[url.path] || ctx.vars?.[url.path] || ''
    }
    
    // Get pageText from the variable store where we stored it
    // Try both vars and state (different agent-99 versions might use different locations)
    const pageText = ctx.state?.pageText || ctx.vars?.pageText || ''
    debugLog('buildUserPrompt: URL:', resolvedUrl)
    debugLog('buildUserPrompt: Retrieved pageText type:', typeof pageText, 'length:', pageText?.length || 0)
    
    // Limit pageText to 3000 chars for token efficiency
    const limitedText = typeof pageText === 'string' ? pageText.substring(0, 3000) : String(pageText || '')
    
    // Validate that we have actual content - if pageText is empty, this indicates HTML extraction failed
    if (!limitedText || limitedText.trim().length === 0) {
      debugWarn(`buildUserPrompt: No page text extracted from ${resolvedUrl} - HTML extraction may have failed`)
      debugLog('buildUserPrompt: pageText value:', pageText)
      debugLog('buildUserPrompt: ctx.state keys:', Object.keys(ctx.state || {}))
      debugLog('buildUserPrompt: ctx.vars keys:', Object.keys(ctx.vars || {}))
      // Return a prompt that explicitly states no content was found
      return `Generate alt-text for a link to this webpage: ${resolvedUrl}

WARNING: No text content could be extracted from this webpage. The HTML may be empty, inaccessible, or the page may require JavaScript to render content.

Since no content is available, please return a JSON response with:
- "altText": A generic description based on the URL domain (e.g., "ABC News website" for abc.net.au)
- "topic": A generic topic based on the domain

Return your response as JSON with "altText" and "topic" fields.`
    }
    
    // Debug: Log first 200 chars of extracted text to verify content
    debugLog('buildUserPrompt: Sending to LLM - first 200 chars:', limitedText.substring(0, 200).replace(/\n/g, ' '))
    
    return `Generate alt-text for a link to this webpage: ${resolvedUrl}

Here is the extracted text content from the webpage (first 3000 characters):

${limitedText}

Based on this ACTUAL content from the page, generate a concise alt-text summary suitable for accessibility purposes. 
IMPORTANT: Your response MUST be based on the actual content above, not on assumptions about what the page might contain.
Return your response as JSON with "altText" and "topic" fields.`
  },
  { docs: 'Build user prompt for LLM from URL (param) and pageText (from variable store)', cost: 1 }
)

/**
 * Creates a custom LLM atom with longer timeout for reasoning models
 */
const llmPredictBatteryLongTimeout = defineAtom(
  'llmPredictBattery',
  s.object({
    system: s.string,
    user: s.string,
    tools: s.array(s.any),        // OpenAI-compatible tool definitions - structure varies
    responseFormat: s.any,        // OpenAI-compatible response format (json_schema, etc.)
  }),
  s.object({
    content: s.string,
    tool_calls: s.array(s.any),   // OpenAI-compatible tool calls - structure varies
  }),
  async ({ system, user, tools, responseFormat }: any, ctx: any) => {
    const llmCap = ctx.capabilities.llm
    if (!llmCap?.predict) {
      throw new Error("Capability 'llm' missing or invalid.")
    }
    
    // Helper to resolve argument references
    const resolveArg = (value: any): any => {
      if (value && typeof value === 'object' && '$kind' in value && value.$kind === 'arg') {
        return ctx.state?.[value.path] || ctx.vars?.[value.path] || ''
      }
      return value
    }
    
    const resolvedSystem = (system && system !== '') ? resolveArg(system) : 'You are a helpful agent.'
    
    // Resolve user argument reference first
    let userValue = resolveArg(user)
    
    // Ensure user is a string
    let resolvedUser: string
    if (typeof userValue === 'string') {
      resolvedUser = userValue
    } else if (userValue && typeof userValue === 'object' && 'content' in userValue) {
      resolvedUser = String(userValue.content)
    } else {
      resolvedUser = String(userValue || '')
    }
    
    // Debug: Log what we're actually sending to the LLM
    debugLog('llmPredictBattery: User prompt length:', resolvedUser.length, 'chars')
    debugLog('llmPredictBattery: First 100 chars:', resolvedUser.substring(0, 100).replace(/\n/g, ' '))
    
    const resolvedTools = tools || undefined
    const resolvedFormat = responseFormat || undefined
    return llmCap.predict(resolvedSystem, resolvedUser, resolvedTools, resolvedFormat)
  },
  { docs: 'Generate completion using LLM battery (long timeout)', cost: 100, timeoutMs: 60000 } // 60 second timeout
)

/**
 * Creates a vision-capable LLM atom for image analysis
 */
const llmVisionBattery = defineAtom(
  'llmVisionBattery',
  s.object({
    system: s.string,
    userText: s.string,
    imageDataUri: s.string,
    responseFormat: s.any,        // OpenAI-compatible response format (json_schema, etc.)
  }),
  s.object({
    content: s.string,
    tool_calls: s.array(s.any),   // OpenAI-compatible tool calls - structure varies
  }),
  async ({ system, userText, imageDataUri, responseFormat }: any, ctx: any) => {
    const llmCap = ctx.capabilities.llm
    if (!llmCap?.predictWithVision) {
      throw new Error("Capability 'llm.predictWithVision' missing or invalid.")
    }
    const resolvedSystem = (system && system !== '') ? system : 'You are a helpful agent.'
    return llmCap.predictWithVision(resolvedSystem, userText, imageDataUri, responseFormat)
  },
  { docs: 'Generate completion using LLM vision battery for image analysis', cost: 200, timeoutMs: 60000 } // Higher cost for vision
)

/**
 * Custom atom for fetching image data and converting to base64
 * Uses httpFetch atom internally for capability-based security
 */
const fetchImageDataAtom = defineAtom(
  'fetchImageData',
  s.object({ imageUrl: s.string }),
  s.object({
    size: s.number,
    base64: s.string,
    width: s.any,   // number | undefined - image width if detected
    height: s.any,  // number | undefined - image height if detected
  }),
  async ({ imageUrl }: { imageUrl: string }, ctx: any) => {
    // Use fetch capability (which should be provided via httpFetch atom in pipeline)
    // For now, we'll use the fetch capability directly
    const fetchCap = ctx.capabilities.fetch || fetch
    const response = await fetchCap(imageUrl)
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
    const dataUri = `data:${contentType};base64,${base64}`
    
    return {
      size,
      base64: dataUri,
    }
  },
  { docs: 'Fetch image data and convert to base64 data URI', cost: 10 }
)

/**
 * Custom atom for processing candidate images in parallel
 * Fetches image data and scores them for interestingness
 */
const processCandidateImagesAtom = defineAtom(
  'processCandidateImages',
  s.object({
    candidates: s.array(imageInfoSchema),
    pageContext: s.any,  // { altText: string, topic: string } | undefined - page context for scoring
  }),
  s.array(scoredCandidateSchema),
  async ({ candidates, pageContext }: any, ctx: any) => {
    // Resolve argument references (check args first for values passed to vm.run())
    let actualCandidates = candidates
    if (candidates && typeof candidates === 'object' && '$kind' in candidates && candidates.$kind === 'arg') {
      debugLog('processCandidateImages: Resolving candidates. Path:', candidates.path)
      actualCandidates = ctx.args?.[candidates.path] || ctx.state?.[candidates.path] || ctx.vars?.[candidates.path] || []
      debugLog('processCandidateImages: Resolved to array of length:', actualCandidates?.length || 0)
    }
    
    if (!Array.isArray(actualCandidates)) {
      debugWarn('processCandidateImages: candidates is not an array:', typeof actualCandidates)
      return []
    }
    
    const fetchCap = ctx.capabilities.fetch || fetch
    const llmCap = ctx.capabilities.llm
    
    // Fetch image data for all candidates in parallel
    const candidateData = await Promise.all(
      actualCandidates.map(async (img: ImageInfo) => {
        try {
          const response = await fetchCap(img.url)
          if (!response.ok) {
            throw new Error(`Failed to fetch image: ${response.status}`)
          }
          
          const arrayBuffer = await response.arrayBuffer()
          const size = arrayBuffer.byteLength
          const buffer = Buffer.from(arrayBuffer)
          const base64 = buffer.toString('base64')
          const contentType = response.headers.get('content-type') || 'image/jpeg'
          const dataUri = `data:${contentType};base64,${base64}`
          
          img.size = size
          return { img, imageData: { size, base64: dataUri }, error: null }
        } catch (error) {
          debugWarn(`Failed to fetch image ${img.url}:`, error)
          return { img, imageData: null, error }
        }
      })
    )
    
    // Filter out failed fetches
    const validCandidates = candidateData.filter(c => c.imageData !== null && c.error === null)
    
    if (validCandidates.length === 0) {
      return []
    }
    
    // Score all candidates in parallel
    const scoredCandidates = await Promise.all(
      validCandidates.map(async ({ img, imageData }: any) => {
        try {
          if (!llmCap?.predictWithVision) {
            // Fallback score if vision not available
            const fallbackScore = img.area ? Math.min(50, img.area / 10000) : 
                                img.size ? Math.min(50, img.size / 100000) : 0
            return { img, imageData, score: fallbackScore }
          }
          
          const systemPrompt = `You are an image analysis expert. Score images 0-100 for interestingness. Return JSON with "score" field.`
          let userPrompt = `Score this image: ${img.url}`
          if (pageContext) {
            userPrompt += `\nPage: ${pageContext.topic}`
          }
          
          const responseFormat = {
            type: 'json_schema',
            json_schema: {
              name: 'interestingness_score',
              schema: {
                type: 'object',
                properties: {
                  score: { type: 'number', minimum: 0, maximum: 100 },
                },
                required: ['score'],
              },
            },
          }
          
          const llmResponse = await llmCap.predictWithVision(
            systemPrompt,
            userPrompt,
            imageData.base64,
            responseFormat
          )
          
          const parsed = JSON.parse(llmResponse.content)
          const score = parsed.score || 0
          return { img, imageData, score }
        } catch (error) {
          // Fallback score
          const fallbackScore = img.area ? Math.min(50, img.area / 10000) : 
                              img.size ? Math.min(50, img.size / 100000) : 0
          return { img, imageData, score: fallbackScore }
        }
      })
    )
    
    return scoredCandidates
  },
  { docs: 'Process candidate images in parallel: fetch and score', cost: 250, timeoutMs: 120000 }
)

/**
 * Custom atom for scoring image interestingness
 * Uses llmVisionBattery internally for vision analysis
 */
const scoreImageInterestingnessAtom = defineAtom(
  'scoreImageInterestingness',
  s.object({
    imageDataUri: s.string,
    imageInfo: imageInfoSchema,
    pageContext: s.any,  // { altText: string, topic: string } | undefined - page context for scoring
  }),
  s.number,
  async ({ imageDataUri, imageInfo, pageContext }: any, ctx: any) => {
    const systemPrompt = `You are an image analysis expert. Your task is to score images on a scale of 0-100 for how "interesting" or informative they are.

Consider these factors:
- Visual complexity and content richness (charts, diagrams, photos with detail > simple icons)
- Informative value (does it convey meaningful information vs being purely decorative?)
- Relevance to typical webpage content (main content images > decorative elements)
- Presence of text, data visualizations, or complex scenes
- Overall visual appeal and engagement

Score guidelines:
- 0-20: Simple icons, logos, decorative elements, tracking pixels
- 21-40: Simple graphics, basic illustrations
- 41-60: Standard photos, moderate complexity
- 61-80: Rich content images, charts, diagrams, detailed photos
- 81-100: Highly informative images, complex data visualizations, key content images

Return your response as JSON with a single "score" field (0-100).`

    let userPrompt = `Score this image for interestingness:

Image URL: ${imageInfo.url}
${imageInfo.alt ? `Alt text: ${imageInfo.alt}` : 'No alt text available'}
${imageInfo.width && imageInfo.height ? `Dimensions: ${imageInfo.width}x${imageInfo.height}` : ''}`

    if (pageContext) {
      userPrompt += `

Page Context:
- Page Topic: ${pageContext.topic}
- Page Description: ${pageContext.altText}

Consider how relevant and informative this image is in the context of this page.`
    }

    userPrompt += `

Return JSON with "score" field (0-100).`

    const responseFormat = {
      type: 'json_schema',
      json_schema: {
        name: 'interestingness_score',
        schema: {
          type: 'object',
          properties: {
            score: {
              type: 'number',
              description: 'Interestingness score from 0-100',
              minimum: 0,
              maximum: 100,
            },
          },
          required: ['score'],
        },
      },
    }

    const llmCap = ctx.capabilities.llm
    if (!llmCap?.predictWithVision) {
      throw new Error("Capability 'llm.predictWithVision' missing or invalid.")
    }

    try {
      const llmResponse = await llmCap.predictWithVision(
        systemPrompt,
        userPrompt,
        imageDataUri,
        responseFormat
      )

      const parsed = JSON.parse(llmResponse.content)
      return parsed.score || 0
    } catch (error) {
      // Fallback: use size/area as a proxy for interestingness
      if (imageInfo.area) return Math.min(50, imageInfo.area / 10000)
      if (imageInfo.size) return Math.min(50, imageInfo.size / 100000)
      return 0
    }
  },
  { docs: 'Score image for interestingness using LLM vision', cost: 200, timeoutMs: 60000 }
)

/**
 * Creates a VM instance configured with battery capabilities for local development
 *
 * Uses batteryAtoms (agent-99 0.0.3+) which consolidates storeVectorize, storeSearch,
 * and llmPredictBattery into a single import. Custom atoms can override battery defaults.
 */
function createVM() {
  return new AgentVM({
    // Include all standard battery atoms (storeVectorize, storeSearch, llmPredictBattery, etc.)
    ...batteryAtoms,
    // Override llmPredictBattery with custom long timeout version
    llmPredictBattery: llmPredictBatteryLongTimeout,
    // Custom atoms for this application
    llmVisionBattery,
    extractResponseText,
    htmlExtractText,
    buildUserPrompt,
    extractImagesFromHTML: extractImagesFromHTMLAtom,
    filterCandidateImages: filterCandidateImagesAtom,
    fetchImageData: fetchImageDataAtom,
    scoreImageInterestingness: scoreImageInterestingnessAtom,
    processCandidateImages: processCandidateImagesAtom,
  })
}

/**
 * Test function to verify vision atom works with agent-99
 * This function uses the vision atom within agent-99's execution model
 * @param imageDataUri - Base64 data URI of the image to analyze
 * @param llmBaseUrl - Optional custom LLM base URL
 * @returns Object containing the alt-text and description
 */
export async function testVisionAtom(imageDataUri: string, llmBaseUrl?: string) {
  const vm = createVM()
  const b = vm.A99
  
  const systemPrompt = `You are an accessibility expert. Describe this image concisely. Return JSON with "altText" (50-200 chars) and optional "description".`
  const userPrompt = `Analyze this image and generate alt-text.`
  
  const responseFormat = {
    type: 'json_schema',
    json_schema: {
      name: 'image_alt_text_result',
      schema: {
        type: 'object',
        properties: {
          altText: { type: 'string', description: 'Alt-text (50-200 characters)' },
          description: { type: 'string', description: 'Detailed description (optional)' },
        },
        required: ['altText'],
      },
    },
  }
  
  // Build the agent logic chain using vision battery
  const logic = b
    .llmVisionBattery({
      system: systemPrompt,
      userText: userPrompt,
      imageDataUri,
      responseFormat,
    })
    .as('summary')
    .varGet({ key: 'summary.content' })
    .as('jsonContent')
    .jsonParse({ str: 'jsonContent' })
    .as('parsed')
    .varSet({ key: 'altText', value: 'parsed.altText' })
    .varSet({ key: 'description', value: 'parsed.description' })
    .return(
      s.object({
        altText: s.string,
        description: s.any, // Optional field - can be string or undefined
      })
    )
  
  // Compile to AST
  const ast = logic.toJSON()
  
  // Execute in VM with capabilities
  const llmUrl = llmBaseUrl || DEFAULT_LLM_URL
  const finalLlmUrl = llmUrl.endsWith('/v1') ? llmUrl : `${llmUrl}/v1`
  
  // Create capabilities with vision support - always use createCustomCapabilities
  // since it includes predictWithVision implementation
  const customCapabilities = createCustomCapabilities(finalLlmUrl)
  
  const result = await vm.run(
    ast,
    {},
    {
      fuel: 10000,
      capabilities: customCapabilities,
    }
  )
  
  // Parse the result
  let altText = result.result?.altText
  let description = result.result?.description
  
  // If not found, try parsing from content field
  if (!altText && result.result?.summary?.content) {
    try {
      const parsed = JSON.parse(result.result.summary.content)
      altText = parsed.altText
      description = parsed.description
    } catch {
      altText = result.result.summary.content
    }
  }
  
  return {
    altText: altText || 'Unable to generate alt-text',
    description: description || undefined,
    fuelUsed: result.fuelUsed,
  }
}

/**
 * Generates alt-text summary for a given URL using agent-99
 * This demonstrates using httpFetch atom and llmPredictBattery atom in a chain
 * @param url - The URL to scrape and summarize
 * @param llmBaseUrl - Optional custom LLM base URL (defaults to localhost:1234)
 * @returns Object containing the alt-text and metadata
 */
export async function generateAltText(url: string, llmBaseUrl?: string) {
  const vm = createVM()
  const b = vm.A99

  // Build the agent logic chain using httpFetch inside the VM
  // This follows agent-99's "agents-as-data" principle - all logic is in the VM
  const logic = b
    // Fetch the webpage using httpFetch atom (capability-based security)
    // httpFetch may return a Response object (when using custom fetch) or text directly
    .httpFetch({ url: A99.args('url') })
    .as('httpResult')
    // Extract text from Response if needed (Response body can only be read once)
    // Use custom atom to handle both Response objects and strings
    .extractResponseText({ response: A99.args('httpResult') })
    .as('html')
    // Store HTML in variable store for later use
    .varSet({ key: 'html', value: 'html' })
    // Get html from state for extraction
    .varGet({ key: 'html' })
    .as('htmlValue')
    // Extract text from HTML using custom atom
    .htmlExtractText({ html: A99.args('htmlValue') })
    .as('pageText')
    // Store pageText in variable for prompt construction
    .varSet({ key: 'pageText', value: 'pageText' })
    // Construct user prompt - URL comes from input args, pageText from variable store
    .buildUserPrompt({
      url: A99.args('url'),
    })
    .as('userPrompt')
    // Store userPrompt in variable store for LLM call
    .varSet({ key: 'userPrompt', value: 'userPrompt' })
    // Get userPrompt from variable store to pass to LLM
    .varGet({ key: 'userPrompt' })
    .as('userPromptValue')
    // Use LLM to generate alt-text from the extracted page content
    .llmPredictBattery({
      system: `You are an accessibility expert. Your task is to generate concise, descriptive alt-text that would be suitable for a link to a webpage. 
The alt-text should:
- Be 50-150 characters long
- Describe the main topic or purpose of the page
- Be clear and informative
- Avoid redundant phrases like "link to" or "page about"
- Focus on what the user would find on the page

You will receive webpage content (which may include HTML). Extract the meaningful text content and generate appropriate alt-text based on the page's main topic and purpose.`,
      user: A99.args('userPromptValue'),
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
  const customCapabilities = llmBaseUrl 
    ? createCustomCapabilities(llmBaseUrl)
    : batteries

  // Provide fetch capability for httpFetch atom
  const capabilitiesWithFetch = {
    ...customCapabilities,
    fetch: customCapabilities.fetch || batteries.fetch || fetch,
  }

  const result = await vm.run(
    ast,
    { url },
    {
      fuel: 10000, // Execution budget
      capabilities: capabilitiesWithFetch, // Enable battery capabilities (LLM, HTTP fetch, etc.)
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
    debugLog('Debug - result structure:', JSON.stringify(result.result, null, 2))
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
  const llmBaseUrl = process.env.LLM_URL || DEFAULT_LLM_URL.replace('/v1', '')
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

