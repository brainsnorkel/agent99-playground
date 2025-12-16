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
    console.warn('extractImagesFromHTML: html is not a string, got:', typeof html, html)
    return []
  }
  
  // Extract <img> tags (including self-closing and with attributes)
  const imgRegex = /<img[^>]+>/gi
  const matches = Array.from(html.matchAll(imgRegex))
  
  // Debug: log how many img tags found
  if (matches.length === 0) {
    console.warn('extractImagesFromHTML: No <img> tags found in HTML')
  } else {
    console.log(`extractImagesFromHTML: Found ${matches.length} <img> tags`)
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
      console.debug('extractImagesFromHTML: Skipping img tag with no src:', imgTag.substring(0, 100))
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
    console.debug(`extractImagesFromHTML: Extracted image: ${largestSrcsetUrl.substring(0, 80)}... (${width}x${height})`)
  }
  
  // Debug: log total images found
  console.log(`extractImagesFromHTML: Extracted ${images.length} images from ${matches.length} img tags`)
  
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
  
  return images
}

/**
 * Fetches an image and returns its size and base64 representation
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
 * Filters images to those larger than icon size and limits to top candidates
 * Icon size threshold: area > 10000 (roughly 100x100) or width > 100 and height > 100
 */
function filterCandidateImages(images: ImageInfo[], maxCandidates: number = 3): ImageInfo[] {
  // Filter to images larger than icon size
  const candidates = images.filter(img => {
    // If we have area, use that (area > 10000 = roughly 100x100)
    if (img.area && img.area > 10000) return true
    // If we have both width and height, check both
    if (img.width && img.height && img.width > 100 && img.height > 100) return true
    // If we only have width or height, check if it's substantial
    if (img.width && img.width > 200) return true
    if (img.height && img.height > 200) return true
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
        candidates: s.array(s.object({
          img: s.object({
            url: s.string,
            width: s.any,
            height: s.any,
            alt: s.any,
            area: s.any,
            size: s.any,
          }),
          imageData: s.object({
            size: s.number,
            base64: s.string,
          }),
          score: s.number,
        })),
      })
    )
  
  // Compile to AST
  const ast = logic.toJSON()
  
  // Execute in VM with capabilities
  const llmUrl = llmBaseUrl || 'http://192.168.1.61:1234/v1'
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
    console.error('VM execution failed:', vmError.message)
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
  
  console.log(`Selected most interesting image: ${mostInteresting.img.url} (score: ${mostInteresting.score})`)
  
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
    console.error('VM execution failed for alt-text generation:', vmError.message)
    console.error('VM error stack:', vmError.stack)
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
        images: s.array(s.object({
          url: s.string,
          width: s.any,
          height: s.any,
          alt: s.any,
          area: s.any,
          size: s.any,
        })),
      })
    )
  
  // Compile to AST
  const ast = logic.toJSON()
  
  // Execute in VM with capabilities
  const llmUrl = llmBaseUrl || 'http://192.168.1.61:1234/v1'
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
  let fuelUsed: number | undefined
  
  try {
    pipelineResult = await vm.run(
      ast,
      { url },
      {
        fuel: 50000, // Higher fuel for combined processing
        capabilities: capabilitiesWithFetch,
      }
    )
    
    fuelUsed = pipelineResult?.fuelUsed
    pageAltText = pipelineResult?.result?.pageAltText
    pageTopic = pipelineResult?.result?.pageTopic
    const images = pipelineResult?.result?.images || []
    
    // Validate that we got meaningful results - check if HTML extraction succeeded
    const htmlContent = pipelineResult?.vars?.html || ''
    const pageTextContent = pipelineResult?.vars?.pageText || ''
    const responseObj = pipelineResult?.vars?.response
    
    // Debug: Log response structure
    if (responseObj) {
      console.log('Response object keys:', Object.keys(responseObj))
      if (responseObj.text) {
        console.log(`Response.text length: ${responseObj.text.length} chars`)
      } else {
        console.warn('Response object exists but has no .text property')
        console.log('Response object sample:', JSON.stringify(responseObj).substring(0, 200))
      }
    } else {
      console.warn('No response object found in pipeline vars')
    }
    
    if (!htmlContent || htmlContent.trim().length === 0) {
      console.warn('WARNING: No HTML content was fetched from the URL. The LLM response may be generic/hallucinated.')
      console.warn('Debug - pipeline vars keys:', Object.keys(pipelineResult?.vars || {}))
    } else if (!pageTextContent || pageTextContent.trim().length === 0) {
      console.warn('WARNING: HTML was fetched but no text could be extracted. The page may require JavaScript or have no text content.')
    }
    
    console.log('Pipeline result - pageAltText:', pageAltText, 'pageTopic:', pageTopic)
    console.log(`Found ${images.length} image(s) on the page`)
    if (htmlContent) {
      console.log(`HTML content length: ${htmlContent.length} chars, extracted text length: ${pageTextContent.length} chars`)
    }
  } catch (vmError: any) {
    console.error('VM execution failed:', vmError.message)
    console.error('VM error stack:', vmError.stack)
    pageAltText = undefined
    pageTopic = undefined
    fuelUsed = undefined
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
            candidates: s.array(s.object({
              img: s.object({
                url: s.string,
                width: s.any,
                height: s.any,
                alt: s.any,
                area: s.any,
                size: s.any,
              }),
              imageData: s.object({
                size: s.number,
                base64: s.string,
              }),
              score: s.number,
            })),
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
        
        const scoredCandidates = imagePipelineResult?.result?.candidates || []
        console.log('Image pipeline result:', JSON.stringify(imagePipelineResult?.result || {}).substring(0, 500))
        console.log('Scored candidates count:', scoredCandidates.length)
        
        if (scoredCandidates.length === 0) {
          console.log('No candidate images processed')
        } else {
          console.log('First scored candidate:', JSON.stringify(scoredCandidates[0] || {}).substring(0, 300))
          
          // Find the most interesting image - with safety check
          const validScoredCandidates = scoredCandidates.filter((c: any) => c && c.img && c.score !== undefined)
          if (validScoredCandidates.length === 0) {
            console.log('No valid scored candidates with img and score')
          } else {
            const mostInteresting = validScoredCandidates.reduce((best: any, current: any) => 
              current.score > best.score ? current : best
            )
            
            console.log(`Selected most interesting image: ${mostInteresting.img.url} (score: ${mostInteresting.score})`)
            
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
              console.error('VM execution failed for image alt-text:', vmError.message)
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
        console.error('Image pipeline failed:', imagePipelineError.message)
      }
    } catch (error: any) {
      console.error('Image processing failed:', error.message)
      console.error('Error stack:', error.stack)
      console.error('Error details:', error)
      // Don't silently fail - log the error but continue
      imageResult = null
    }
  } else {
    console.log('No images found on the page')
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
  } = {
    url,
    pageAltText: finalPageAltText,
    pageTopic: finalPageTopic,
  }
  
  // Only add optional fields if they have values (to avoid undefined in JSON)
  if (fuelUsed !== undefined) {
    finalResult.fuelUsed = fuelUsed
  }
  if (imageResult?.imageUrl) {
    finalResult.imageUrl = imageResult.imageUrl
    if (imageResult.altText) finalResult.imageAltText = imageResult.altText
    if (imageResult.description) finalResult.imageDescription = imageResult.description
    if (imageResult.imageWidth !== undefined) finalResult.imageWidth = imageResult.imageWidth
    if (imageResult.imageHeight !== undefined) finalResult.imageHeight = imageResult.imageHeight
    if (imageResult.imageSize !== undefined) finalResult.imageSize = imageResult.imageSize
  }
  
  console.log('Final result:', {
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
    console.error('ERROR: Final result missing required fields!', finalResult)
  }
  
  return finalResult
}

/**
 * Creates custom capabilities with custom LLM URL
 */
function createCustomCapabilities(llmBaseUrl: string) {
  // Start with standard batteries
  const customCaps = { ...batteries }
  
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
          let errorMessage: string
          
          // Provide helpful error messages for common issues
          if (errorText.includes('No models loaded')) {
            errorMessage = `LLM Error: No model loaded in LM Studio.\n\n` +
              `To fix this:\n` +
              `1. Open LM Studio\n` +
              `2. Go to the "Chat" tab\n` +
              `3. Select and load a model from the dropdown\n` +
              `4. Ensure the Local Server is running (View → Local Server)\n` +
              `5. Try again`
          } else if (response.status === 401) {
            errorMessage = `LLM Error: Authentication failed (401 Unauthorized).\n\n` +
              `The LLM server at ${llmBaseUrl} requires authentication.\n` +
              `Please check your API key or authentication settings.`
          } else if (response.status === 404) {
            errorMessage = `LLM Error: Endpoint not found (404).\n\n` +
              `The LLM server at ${llmBaseUrl} does not have the /chat/completions endpoint.\n` +
              `Please verify the server URL is correct and the server supports OpenAI-compatible API.`
          } else if (response.status === 429) {
            errorMessage = `LLM Error: Rate limit exceeded (429).\n\n` +
              `The LLM server is receiving too many requests.\n` +
              `Please wait a moment and try again.`
          } else if (response.status >= 500) {
            errorMessage = `LLM Error: Server error (${response.status}).\n\n` +
              `The LLM server at ${llmBaseUrl} encountered an internal error.\n` +
              `Please check if the server is running properly and try again later.`
          } else {
            errorMessage = `LLM Error: ${response.status} ${response.statusText}\n\n` +
              `Server: ${llmBaseUrl}\n` +
              `Details: ${errorText.substring(0, 200)}`
          }
          
          throw new Error(errorMessage)
        }

        const data = await response.json() as any
        return data.choices[0]?.message ?? { content: '' }
      } catch (error: any) {
        // Handle connection errors with helpful messages
        const errorCode = error.cause?.code || error.code
        const errorMessage = error.message || String(error)
        
        if (errorCode === 'ECONNREFUSED' || errorMessage.includes('ECONNREFUSED')) {
          throw new Error(
            `LLM Connection Failed: Cannot connect to LLM server.\n\n` +
            `Server URL: ${llmBaseUrl}\n\n` +
            `Possible solutions:\n` +
            `1. Ensure LM Studio is running and the Local Server is started\n` +
            `2. Check that the server URL is correct (should be like http://localhost:1234/v1)\n` +
            `3. Verify the server is accessible from this machine\n` +
            `4. Check your firewall settings\n\n` +
            `To start LM Studio server:\n` +
            `- Open LM Studio\n` +
            `- Load a model in the Chat tab\n` +
            `- Go to View → Local Server\n` +
            `- Click "Start Server"`
          )
        } else if (errorCode === 'ENOTFOUND' || errorMessage.includes('ENOTFOUND') || errorMessage.includes('getaddrinfo')) {
          throw new Error(
            `LLM Connection Failed: Cannot resolve server hostname.\n\n` +
            `Server URL: ${llmBaseUrl}\n\n` +
            `The hostname in the URL cannot be resolved.\n` +
            `Please check:\n` +
            `1. The server URL is correct\n` +
            `2. Your network connection is working\n` +
            `3. DNS resolution is working properly`
          )
        } else if (errorCode === 'ETIMEDOUT' || errorMessage.includes('timeout') || errorMessage.includes('TIMEDOUT')) {
          throw new Error(
            `LLM Connection Failed: Request timed out.\n\n` +
            `Server URL: ${llmBaseUrl}\n\n` +
            `The LLM server did not respond within 60 seconds.\n` +
            `Possible causes:\n` +
            `1. The server is overloaded or slow\n` +
            `2. Network connectivity issues\n` +
            `3. The server is not running or not accessible\n\n` +
            `Please check the server status and try again.`
          )
        } else if (errorCode === 'ECONNRESET' || errorMessage.includes('ECONNRESET')) {
          throw new Error(
            `LLM Connection Failed: Connection was reset by the server.\n\n` +
            `Server URL: ${llmBaseUrl}\n\n` +
            `The connection was unexpectedly closed by the server.\n` +
            `This might indicate:\n` +
            `1. The server crashed or restarted\n` +
            `2. Network instability\n` +
            `3. The server rejected the connection\n\n` +
            `Please check the server status and try again.`
          )
        } else if (error.name === 'AbortError' || errorMessage.includes('aborted')) {
          throw new Error(
            `LLM Connection Failed: Request was aborted (timeout).\n\n` +
            `Server URL: ${llmBaseUrl}\n\n` +
            `The request took too long and was cancelled.\n` +
            `This might indicate:\n` +
            `1. The server is very slow or unresponsive\n` +
            `2. The model is taking too long to process\n` +
            `3. Network issues\n\n` +
            `Please try again or use a faster model.`
          )
        } else if (errorMessage.includes('fetch failed') || errorMessage.includes('Failed to fetch')) {
          throw new Error(
            `LLM Connection Failed: Network request failed.\n\n` +
            `Server URL: ${llmBaseUrl}\n\n` +
            `Unable to make a network request to the LLM server.\n` +
            `Please check:\n` +
            `1. The server URL is correct\n` +
            `2. The server is running and accessible\n` +
            `3. Your network connection is working\n` +
            `4. CORS settings (if accessing a remote server)`
          )
        }
        
        // If it's already a formatted error message, re-throw it
        if (errorMessage.includes('LLM Error:') || errorMessage.includes('LLM Connection Failed:')) {
          throw error
        }
        
        // Otherwise, provide a generic but helpful error
        throw new Error(
          `LLM Connection Failed: ${errorMessage}\n\n` +
          `Server URL: ${llmBaseUrl}\n\n` +
          `Please check:\n` +
          `1. The server is running and accessible\n` +
          `2. The URL is correct\n` +
          `3. Your network connection is working\n` +
          `4. The server supports the OpenAI-compatible API format`
        )
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
          let errorMessage: string
          
          // Provide helpful error messages for common issues
          if (errorText.includes('No models loaded')) {
            errorMessage = `LLM Vision Error: No model loaded in LM Studio.\n\n` +
              `To fix this:\n` +
              `1. Open LM Studio\n` +
              `2. Go to the "Chat" tab\n` +
              `3. Select and load a model from the dropdown\n` +
              `4. Ensure the Local Server is running (View → Local Server)\n` +
              `5. Try again`
          } else if (response.status === 401) {
            errorMessage = `LLM Vision Error: Authentication failed (401 Unauthorized).\n\n` +
              `The LLM server at ${llmBaseUrl} requires authentication.\n` +
              `Please check your API key or authentication settings.`
          } else if (response.status === 404) {
            errorMessage = `LLM Vision Error: Endpoint not found (404).\n\n` +
              `The LLM server at ${llmBaseUrl} does not have the /chat/completions endpoint.\n` +
              `Please verify the server URL is correct and the server supports OpenAI-compatible vision API.`
          } else if (response.status === 429) {
            errorMessage = `LLM Vision Error: Rate limit exceeded (429).\n\n` +
              `The LLM server is receiving too many requests.\n` +
              `Please wait a moment and try again.`
          } else if (response.status >= 500) {
            errorMessage = `LLM Vision Error: Server error (${response.status}).\n\n` +
              `The LLM server at ${llmBaseUrl} encountered an internal error.\n` +
              `Please check if the server is running properly and try again later.`
          } else {
            errorMessage = `LLM Vision Error: ${response.status} ${response.statusText}\n\n` +
              `Server: ${llmBaseUrl}\n` +
              `Details: ${errorText.substring(0, 200)}`
          }
          
          throw new Error(errorMessage)
        }

        const data = await response.json() as any
        return data.choices[0]?.message ?? { content: '' }
      } catch (error: any) {
        // Handle connection errors with helpful messages (same as predict)
        const errorCode = error.cause?.code || error.code
        const errorMessage = error.message || String(error)
        
        if (errorCode === 'ECONNREFUSED' || errorMessage.includes('ECONNREFUSED')) {
          throw new Error(
            `LLM Vision Connection Failed: Cannot connect to LLM server.\n\n` +
            `Server URL: ${llmBaseUrl}\n\n` +
            `Possible solutions:\n` +
            `1. Ensure LM Studio is running and the Local Server is started\n` +
            `2. Check that the server URL is correct (should be like http://localhost:1234/v1)\n` +
            `3. Verify the server is accessible from this machine\n` +
            `4. Check your firewall settings\n\n` +
            `To start LM Studio server:\n` +
            `- Open LM Studio\n` +
            `- Load a model in the Chat tab\n` +
            `- Go to View → Local Server\n` +
            `- Click "Start Server"`
          )
        } else if (errorCode === 'ENOTFOUND' || errorMessage.includes('ENOTFOUND') || errorMessage.includes('getaddrinfo')) {
          throw new Error(
            `LLM Vision Connection Failed: Cannot resolve server hostname.\n\n` +
            `Server URL: ${llmBaseUrl}\n\n` +
            `The hostname in the URL cannot be resolved.\n` +
            `Please check:\n` +
            `1. The server URL is correct\n` +
            `2. Your network connection is working\n` +
            `3. DNS resolution is working properly`
          )
        } else if (errorCode === 'ETIMEDOUT' || errorMessage.includes('timeout') || errorMessage.includes('TIMEDOUT')) {
          throw new Error(
            `LLM Vision Connection Failed: Request timed out.\n\n` +
            `Server URL: ${llmBaseUrl}\n\n` +
            `The LLM server did not respond within 120 seconds.\n` +
            `Vision requests can take longer - this might indicate:\n` +
            `1. The server is overloaded or slow\n` +
            `2. Network connectivity issues\n` +
            `3. The server is not running or not accessible\n\n` +
            `Please check the server status and try again.`
          )
        } else if (errorCode === 'ECONNRESET' || errorMessage.includes('ECONNRESET')) {
          throw new Error(
            `LLM Vision Connection Failed: Connection was reset by the server.\n\n` +
            `Server URL: ${llmBaseUrl}\n\n` +
            `The connection was unexpectedly closed by the server.\n` +
            `This might indicate:\n` +
            `1. The server crashed or restarted\n` +
            `2. Network instability\n` +
            `3. The server rejected the connection\n\n` +
            `Please check the server status and try again.`
          )
        } else if (error.name === 'AbortError' || errorMessage.includes('aborted')) {
          throw new Error(
            `LLM Vision Connection Failed: Request was aborted (timeout).\n\n` +
            `Server URL: ${llmBaseUrl}\n\n` +
            `The request took too long and was cancelled.\n` +
            `Vision requests can take longer - this might indicate:\n` +
            `1. The server is very slow or unresponsive\n` +
            `2. The model is taking too long to process the image\n` +
            `3. Network issues\n\n` +
            `Please try again or use a faster model.`
          )
        } else if (errorMessage.includes('fetch failed') || errorMessage.includes('Failed to fetch')) {
          throw new Error(
            `LLM Vision Connection Failed: Network request failed.\n\n` +
            `Server URL: ${llmBaseUrl}\n\n` +
            `Unable to make a network request to the LLM server.\n` +
            `Please check:\n` +
            `1. The server URL is correct\n` +
            `2. The server is running and accessible\n` +
            `3. Your network connection is working\n` +
            `4. CORS settings (if accessing a remote server)`
          )
        }
        
        // If it's already a formatted error message, re-throw it
        if (errorMessage.includes('LLM Vision Error:') || errorMessage.includes('LLM Vision Connection Failed:')) {
          throw error
        }
        
        // Otherwise, provide a generic but helpful error
        throw new Error(
          `LLM Vision Connection Failed: ${errorMessage}\n\n` +
          `Server URL: ${llmBaseUrl}\n\n` +
          `Please check:\n` +
          `1. The server is running and accessible\n` +
          `2. The URL is correct\n` +
          `3. Your network connection is working\n` +
          `4. The server supports the OpenAI-compatible vision API format`
        )
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
    // Handle argument references - resolve from state
    let actualResponse = response
    if (response && typeof response === 'object' && '$kind' in response && response.$kind === 'arg') {
      console.log('extractResponseText: Got argument reference, resolving from state. Path:', response.path)
      actualResponse = ctx.state?.[response.path] || ctx.vars?.[response.path]
      console.log('extractResponseText: Resolved response type:', typeof actualResponse)
    }
    
    // Handle different response formats
    if (typeof actualResponse === 'string') {
      console.log(`extractResponseText: Response is already a string, length: ${actualResponse.length} chars`)
      return actualResponse
    } else if (actualResponse && typeof actualResponse === 'object') {
      // Check if it's a Response object with .text() method
      if ('text' in actualResponse && typeof actualResponse.text === 'function') {
        console.log('extractResponseText: Found Response object with .text() method, calling it')
        const text = await actualResponse.text()
        console.log(`extractResponseText: Got text from Response, length: ${text.length} chars`)
        return text
      } else if ('text' in actualResponse && typeof actualResponse.text === 'string') {
        console.log(`extractResponseText: Extracted text property, length: ${actualResponse.text.length} chars`)
        return actualResponse.text
      } else if ('content' in actualResponse && typeof actualResponse.content === 'string') {
        console.log(`extractResponseText: Extracted content, length: ${actualResponse.content.length} chars`)
        return actualResponse.content
      } else if ('body' in actualResponse && typeof actualResponse.body === 'string') {
        console.log(`extractResponseText: Extracted body, length: ${actualResponse.body.length} chars`)
        return actualResponse.body
      } else {
        console.warn('extractResponseText: Response object has no extractable text property')
        console.warn('extractResponseText: Response keys:', Object.keys(actualResponse || {}))
        return ''
      }
    }
    console.warn('extractResponseText: Invalid response type:', typeof actualResponse)
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
    // Debug: Log HTML input
    console.log('htmlExtractText: Received HTML type:', typeof html)
    
    // Handle argument references - resolve from state
    let actualHtml = html
    if (html && typeof html === 'object' && '$kind' in html && html.$kind === 'arg') {
      console.log('htmlExtractText: Got argument reference, resolving from state. Path:', html.path)
      actualHtml = ctx.state?.[html.path] || ctx.vars?.[html.path]
      console.log('htmlExtractText: Resolved HTML type:', typeof actualHtml)
      // Note: HTML should already be extracted text at this point (via extractResponseText)
      // But handle Response objects just in case
      if (actualHtml && typeof actualHtml === 'object') {
        console.log('htmlExtractText: Resolved HTML is object, keys:', Object.keys(actualHtml))
        // If it's a Response object, this is an error - should have been extracted earlier
        if ('text' in actualHtml && typeof actualHtml.text === 'function') {
          console.error('htmlExtractText: ERROR - Found Response object! This should have been extracted by extractResponseText atom')
          // Don't call .text() here as it may have already been consumed
          return ''
        } else if ('text' in actualHtml && typeof actualHtml.text === 'string') {
          console.log('htmlExtractText: Found .text property, using it')
          actualHtml = actualHtml.text
        }
      } else if (typeof actualHtml === 'string') {
        console.log('htmlExtractText: Resolved HTML is string, length:', actualHtml.length)
      }
    }
    
    if (!actualHtml) {
      console.warn('htmlExtractText: Received null/undefined HTML')
      // Try to get from context if not provided directly
      const htmlFromContext = ctx.vars?.html || ctx.state?.html
      if (htmlFromContext) {
        console.log('htmlExtractText: Found HTML in context, length:', htmlFromContext.length)
        return extractTextFromHTML(String(htmlFromContext))
      }
      return ''
    }
    if (typeof actualHtml !== 'string') {
      console.warn('htmlExtractText: HTML is not a string, converting. Type:', typeof actualHtml)
      actualHtml = String(actualHtml)
    }
    if (actualHtml.length === 0) {
      console.warn('htmlExtractText: Received empty HTML string')
      return ''
    }
    console.log(`htmlExtractText: Processing HTML, length: ${actualHtml.length} chars`)
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
  s.array(s.object({
    url: s.string,
    width: s.any,
    height: s.any,
    alt: s.any,
    area: s.any,
    size: s.any,
  })),
  async ({ html, baseUrl }: { html: string; baseUrl: string }, ctx: any) => {
    // Ensure html is a string - handle cases where it might be an object or undefined
    let htmlString: string
    
    // Handle argument references - resolve from state
    let actualHtml = html
    if (html && typeof html === 'object' && html !== null && '$kind' in html && html.$kind === 'arg') {
      console.log('extractImagesFromHTMLAtom: Got argument reference, resolving from state. Path:', html.path)
      actualHtml = ctx.state?.[html.path] || ctx.vars?.[html.path]
      console.log('extractImagesFromHTMLAtom: Resolved HTML type:', typeof actualHtml)
      // Note: HTML should already be extracted text at this point (via extractResponseText)
      // But handle Response objects just in case
      if (actualHtml && typeof actualHtml === 'object') {
        console.log('extractImagesFromHTMLAtom: Resolved HTML is object, keys:', Object.keys(actualHtml))
        // If it's a Response object, this is an error - should have been extracted earlier
        if ('text' in actualHtml && typeof actualHtml.text === 'function') {
          console.error('extractImagesFromHTMLAtom: ERROR - Found Response object! This should have been extracted by extractResponseText atom')
          // Don't call .text() here as it may have already been consumed
          return []
        } else if ('text' in actualHtml && typeof actualHtml.text === 'string') {
          console.log('extractImagesFromHTMLAtom: Found .text property, using it')
          actualHtml = actualHtml.text
        }
      } else if (typeof actualHtml === 'string') {
        console.log('extractImagesFromHTMLAtom: Resolved HTML is string, length:', actualHtml.length)
      }
    }
    
    // First try the direct parameter
    if (typeof actualHtml === 'string' && actualHtml.length > 0) {
      htmlString = actualHtml
    } else if (actualHtml && typeof actualHtml === 'object' && actualHtml !== null) {
      // Try to extract from object
      if ('text' in html && typeof (html as any).text === 'string') {
        htmlString = String((html as any).text)
      } else if ('content' in html && typeof (html as any).content === 'string') {
        htmlString = String((html as any).content)
      } else if ('html' in html && typeof (html as any).html === 'string') {
        htmlString = String((html as any).html)
      } else {
        // Try to get from variable store as fallback
        htmlString = String(ctx.state?.html || ctx.vars?.html || ctx.vars?.['response.text'] || '')
      }
    } else {
      // Try to get from variable store as fallback
      htmlString = String(ctx.state?.html || ctx.vars?.html || ctx.vars?.['response.text'] || actualHtml || '')
    }
    
    // Ensure baseUrl is a string
    let baseUrlString: string
    if (typeof baseUrl === 'string' && baseUrl.length > 0) {
      baseUrlString = baseUrl
    } else if (baseUrl && typeof baseUrl === 'object' && baseUrl !== null && 'url' in baseUrl) {
      baseUrlString = String((baseUrl as any).url)
    } else {
      baseUrlString = String(ctx.vars?.url || baseUrl || '')
    }
    
    // Final validation
    if (!htmlString || htmlString.length === 0) {
      console.warn('extractImagesFromHTMLAtom: No HTML content provided')
      return []
    }
    
    return extractImagesFromHTML(htmlString, baseUrlString)
  },
  { docs: 'Extract image information from HTML string', cost: 5 }
)

/**
 * Custom atom for filtering candidate images
 * Filters to images larger than icon size and limits to top candidates
 */
const filterCandidateImagesAtom = defineAtom(
  'filterCandidateImages',
  s.object({ 
    images: s.array(s.object({
      url: s.string,
      width: s.any,
      height: s.any,
      alt: s.any,
      area: s.any,
      size: s.any,
    })),
    maxCandidates: s.any
  }),
  s.array(s.object({
    url: s.string,
    width: s.any,
    height: s.any,
    alt: s.any,
    area: s.any,
    size: s.any,
  })),
  async ({ images, maxCandidates = 3 }: { images: ImageInfo[]; maxCandidates?: number }, ctx: any) => {
    // Resolve argument references (check args first for values passed to vm.run())
    let actualImages = images
    if (images && typeof images === 'object' && '$kind' in images && images.$kind === 'arg') {
      console.log('filterCandidateImages: Resolving images. Path:', images.path)
      actualImages = ctx.args?.[images.path] || ctx.state?.[images.path] || ctx.vars?.[images.path] || []
      console.log('filterCandidateImages: Resolved to array of length:', actualImages?.length || 0)
    }
    
    if (!Array.isArray(actualImages)) {
      console.error('filterCandidateImages: images is not an array:', typeof actualImages)
      return []
    }
    
    return filterCandidateImages(actualImages, maxCandidates)
  },
  { docs: 'Filter images to candidates larger than icon size', cost: 1 }
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
    console.log('buildUserPrompt: URL:', resolvedUrl)
    console.log('buildUserPrompt: Retrieved pageText type:', typeof pageText, 'length:', pageText?.length || 0)
    
    // Limit pageText to 3000 chars for token efficiency
    const limitedText = typeof pageText === 'string' ? pageText.substring(0, 3000) : String(pageText || '')
    
    // Validate that we have actual content - if pageText is empty, this indicates HTML extraction failed
    if (!limitedText || limitedText.trim().length === 0) {
      console.warn(`buildUserPrompt: No page text extracted from ${resolvedUrl} - HTML extraction may have failed`)
      console.warn('buildUserPrompt: pageText value:', pageText)
      console.warn('buildUserPrompt: ctx.state keys:', Object.keys(ctx.state || {}))
      console.warn('buildUserPrompt: ctx.vars keys:', Object.keys(ctx.vars || {}))
      // Return a prompt that explicitly states no content was found
      return `Generate alt-text for a link to this webpage: ${resolvedUrl}

WARNING: No text content could be extracted from this webpage. The HTML may be empty, inaccessible, or the page may require JavaScript to render content.

Since no content is available, please return a JSON response with:
- "altText": A generic description based on the URL domain (e.g., "ABC News website" for abc.net.au)
- "topic": A generic topic based on the domain

Return your response as JSON with "altText" and "topic" fields.`
    }
    
    // Debug: Log first 200 chars of extracted text to verify content
    console.log('buildUserPrompt: Sending to LLM - first 200 chars:', limitedText.substring(0, 200).replace(/\n/g, ' '))
    
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
    console.log('llmPredictBattery: User prompt length:', resolvedUser.length, 'chars')
    console.log('llmPredictBattery: First 100 chars:', resolvedUser.substring(0, 100).replace(/\n/g, ' '))
    
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
    responseFormat: s.any,
  }),
  s.object({
    content: s.string,
    tool_calls: s.array(s.any),
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
    width: s.any,
    height: s.any,
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
    candidates: s.array(s.object({
      url: s.string,
      width: s.any,
      height: s.any,
      alt: s.any,
      area: s.any,
      size: s.any,
    })),
    pageContext: s.any,
  }),
  s.array(s.object({
    img: s.object({
      url: s.string,
      width: s.any,
      height: s.any,
      alt: s.any,
      area: s.any,
      size: s.any,
    }),
    imageData: s.object({
      size: s.number,
      base64: s.string,
    }),
    score: s.number,
  })),
  async ({ candidates, pageContext }: any, ctx: any) => {
    // Resolve argument references (check args first for values passed to vm.run())
    let actualCandidates = candidates
    if (candidates && typeof candidates === 'object' && '$kind' in candidates && candidates.$kind === 'arg') {
      console.log('processCandidateImages: Resolving candidates. Path:', candidates.path)
      actualCandidates = ctx.args?.[candidates.path] || ctx.state?.[candidates.path] || ctx.vars?.[candidates.path] || []
      console.log('processCandidateImages: Resolved to array of length:', actualCandidates?.length || 0)
    }
    
    if (!Array.isArray(actualCandidates)) {
      console.error('processCandidateImages: candidates is not an array:', typeof actualCandidates)
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
          console.warn(`Failed to fetch image ${img.url}:`, error)
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
    imageInfo: s.object({
      url: s.string,
      width: s.any,
      height: s.any,
      alt: s.any,
      area: s.any,
      size: s.any,
    }),
    pageContext: s.any,
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
 */
function createVM() {
  return new AgentVM({
    storeVectorize,
    storeSearch,
    llmPredictBattery: llmPredictBatteryLongTimeout, // Use custom atom with longer timeout
    llmVisionBattery, // Register vision atom for image processing
    extractResponseText, // Register response text extraction atom
    htmlExtractText, // Register HTML text extraction atom
    buildUserPrompt, // Register user prompt builder atom
    extractImagesFromHTML: extractImagesFromHTMLAtom, // Register image extraction atom
    filterCandidateImages: filterCandidateImagesAtom, // Register image filtering atom
    fetchImageData: fetchImageDataAtom, // Register image fetching atom
    scoreImageInterestingness: scoreImageInterestingnessAtom, // Register image scoring atom
    processCandidateImages: processCandidateImagesAtom, // Register parallel image processing atom
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
  const llmUrl = llmBaseUrl || 'http://192.168.1.61:1234/v1'
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

