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
  
  // Extract <img> tags
  const imgRegex = /<img[^>]+>/gi
  const matches = html.matchAll(imgRegex)

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
    
    // Skip data URIs that are too small (likely icons/sprites)
    if (src && src.startsWith('data:')) {
      // Only include data URIs if they seem substantial (more than just a small icon)
      if (src.length < 1000) continue // Skip small data URIs (likely icons)
    }
    
    if (!src) continue
    
    // Skip very small images (likely icons, sprites, or tracking pixels)
    if (src.includes('icon') || src.includes('sprite') || src.includes('pixel') || src.includes('tracking')) {
      continue
    }
    
    const absoluteUrl = resolveUrl(src, baseUrl)
    
    // Extract width and height attributes (handle formats like "400", "400px", width="400", etc.)
    const widthMatch = imgTag.match(/width\s*=\s*["']?(\d+)/i)
    const heightMatch = imgTag.match(/height\s*=\s*["']?(\d+)/i)
    const altMatch = imgTag.match(/alt=["']([^"']*)["']/i)
    
    // Also check for srcset to get larger image sizes
    const srcsetMatch = imgTag.match(/srcset=["']([^"']+)["']/i)
    let largestSrcsetUrl = absoluteUrl
    if (srcsetMatch) {
      // Parse srcset: "url1 1x, url2 2x, url3 800w" format
      const srcsetEntries = srcsetMatch[1].split(',').map(s => s.trim())
      let largestSize = 0
      for (const entry of srcsetEntries) {
        const parts = entry.split(/\s+/)
        const url = parts[0]
        const size = parts[1] ? parseInt(parts[1]) : 0
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
  }
  
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
 * Scores an image for "interestingness" using LLM vision analysis
 * Returns a score from 0-100 indicating how interesting/informative the image is
 */
async function scoreImageInterestingness(
  imageDataUri: string,
  imageInfo: ImageInfo,
  pageContext: { altText: string; topic: string } | undefined,
  llmBaseUrl: string
): Promise<number> {
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

  try {
    const llmResponse = await predictWithVision(
      llmBaseUrl,
      systemPrompt,
      userPrompt,
      imageDataUri,
      responseFormat
    )

    const parsed = JSON.parse(llmResponse.content)
    return parsed.score || 0
  } catch (error) {
    console.warn(`Failed to score image ${imageInfo.url}:`, error)
    // Fallback: use size/area as a proxy for interestingness
    if (imageInfo.area) return Math.min(50, imageInfo.area / 10000) // Cap at 50 for fallback
    if (imageInfo.size) return Math.min(50, imageInfo.size / 100000) // Cap at 50 for fallback
    return 0
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
    .httpFetch({ url: A99.args('url') })
    .as('response')
    .varGet({ key: 'response.text' })
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
    .httpFetch({ url: A99.args('url') })
    .as('response')
    .varGet({ key: 'response.text' })
    .as('html')
    // Step 2: Extract images and text in parallel (store both)
    .extractImagesFromHTML({ 
      html: A99.args('html'), 
      baseUrl: A99.args('url') 
    })
    .as('images')
    .htmlExtractText({ html: A99.args('html') })
    .as('pageText')
    // Step 3: Store pageText for prompt construction
    .varSet({ key: 'pageText', value: 'pageText' })
    // Step 4: Generate page alt-text and topic using LLM
    .buildUserPrompt({ url: A99.args('url') })
    .as('userPrompt')
    .llmPredictBattery({
      system: `You are an accessibility expert. Your task is to generate concise, descriptive alt-text that would be suitable for a link to a webpage. 
The alt-text should:
- Be 50-150 characters long
- Describe the main topic or purpose of the page
- Be clear and informative
- Avoid redundant phrases like "link to" or "page about"
- Focus on what the user would find on the page

You will receive webpage content (which may include HTML). Extract the meaningful text content and generate appropriate alt-text based on the page's main topic and purpose.`,
      user: A99.args('userPrompt'),
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
    
    console.log('Pipeline result - pageAltText:', pageAltText, 'pageTopic:', pageTopic)
    console.log(`Found ${images.length} image(s) on the page`)
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
        
        if (scoredCandidates.length === 0) {
          console.log('No candidate images processed')
        } else {
          // Find the most interesting image
          const mostInteresting = scoredCandidates.reduce((best: any, current: any) => 
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
 * Custom atom for extracting text from HTML
 * This keeps HTML processing within the VM execution model
 */
const htmlExtractText = defineAtom(
  'htmlExtractText',
  s.object({ html: s.string }),
  s.string,
  async ({ html }: { html: string }, ctx: any) => {
    return extractTextFromHTML(html)
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
    return extractImagesFromHTML(html, baseUrl)
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
    return filterCandidateImages(images, maxCandidates)
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
    // Get pageText from the current result (previous pipeline step)
    // In agent-99, the current result is available via the context
    // For now, we'll get it from the variable store where we stored it
    const pageText = ctx.vars?.pageText || ''
    // Limit pageText to 3000 chars for token efficiency
    const limitedText = typeof pageText === 'string' ? pageText.substring(0, 3000) : String(pageText || '')
    return `Generate alt-text for a link to this webpage: ${url}

Here is the extracted text content from the webpage (first 3000 characters):

${limitedText}

Analyze this content and generate a concise alt-text summary suitable for accessibility purposes. Return your response as JSON with "altText" and "topic" fields.`
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
    const resolvedSystem = (system && system !== '') ? system : 'You are a helpful agent.'
    const resolvedUser = user
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
    const fetchCap = ctx.capabilities.fetch || fetch
    const llmCap = ctx.capabilities.llm
    
    // Fetch image data for all candidates in parallel
    const candidateData = await Promise.all(
      candidates.map(async (img: ImageInfo) => {
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
  
  // Create capabilities with vision support
  const customCapabilities = llmBaseUrl 
    ? createCustomCapabilities(finalLlmUrl)
    : { ...batteries, llm: { ...batteries.llm, predictWithVision: async (system: string, userText: string, imageDataUri: string, responseFormat?: any) => {
        return await predictWithVision(finalLlmUrl, system, userText, imageDataUri, responseFormat)
      } } }
  
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
    .httpFetch({ url: A99.args('url') })
    .as('response')
    .varGet({ key: 'response.text' })
    .as('html')
    // Extract text from HTML using custom atom
    .htmlExtractText({ html: A99.args('html') })
    .as('pageText')
    // Store pageText in variable for prompt construction
    .varSet({ key: 'pageText', value: 'pageText' })
    // Construct user prompt - URL comes from input args, pageText from variable store
    .buildUserPrompt({
      url: A99.args('url'),
    })
    .as('userPrompt')
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
      user: A99.args('userPrompt'),
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

