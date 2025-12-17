import { serve } from 'bun'
import { DEFAULT_LLM_URL } from './config'
import { generateCombinedAltText, FetchErrorInfo, LLMErrorInfo } from './index'

interface QueryResult {
  id: string
  url: string
  timestamp: number
  // Page alt-text fields
  pageAltText: string
  pageTopic: string
  fuelUsed?: number
  // Image alt-text fields
  imageUrl?: string
  imageAltText?: string
  imageDescription?: string
  imageWidth?: number
  imageHeight?: number
  imageSize?: number
  // Error information for sites that couldn't be analyzed
  error?: FetchErrorInfo
  llmError?: LLMErrorInfo
}

// In-memory storage (in production, use a database)
const queryHistory: QueryResult[] = []
const defaultLLMUrl = DEFAULT_LLM_URL

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

serve({
  port: 3000,
  async fetch(req) {
    const url = new URL(req.url)

    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders })
    }

    // Serve static HTML
    if (url.pathname === '/' || url.pathname === '/index.html') {
      const html = await Bun.file(`${import.meta.dir}/index.html`).text()
      return new Response(html, {
        headers: { 'Content-Type': 'text/html', ...corsHeaders },
      })
    }

    // API: Get query history
    if (url.pathname === '/api/history' && req.method === 'GET') {
      return new Response(JSON.stringify(queryHistory), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      })
    }

    // API: Clear query history
    if (url.pathname === '/api/history' && req.method === 'DELETE') {
      queryHistory.length = 0
      return new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      })
    }

    // API: Process URL
    if (url.pathname === '/api/process' && req.method === 'POST') {
      try {
        const body = await req.json()
        const { url: targetUrl, llmUrl } = body

        if (!targetUrl) {
          return new Response(
            JSON.stringify({ error: 'URL is required' }),
            {
              status: 400,
              headers: { 'Content-Type': 'application/json', ...corsHeaders },
            }
          )
        }

        // Add https:// if no scheme is provided
        const normalizedUrl = /^https?:\/\//i.test(targetUrl)
          ? targetUrl
          : `https://${targetUrl}`

        // Use provided LLM URL or default
        const effectiveLLMUrl = llmUrl || defaultLLMUrl
        const finalLLMUrl = effectiveLLMUrl.endsWith('/v1')
          ? effectiveLLMUrl
          : `${effectiveLLMUrl}/v1`

        // Process the URL: generate both page and image alt-text
        console.log(`Processing URL: ${normalizedUrl} with LLM: ${finalLLMUrl}`)
        let result
        try {
          result = await generateCombinedAltText(normalizedUrl, finalLLMUrl)
          console.log(`Processing complete. Result:`, {
            url: result.url,
            pageAltText: result.pageAltText,
            pageTopic: result.pageTopic,
            hasPageAltText: !!result.pageAltText,
            hasImageUrl: !!result.imageUrl,
            hasImageAltText: !!result.imageAltText,
            imageUrl: result.imageUrl,
            resultKeys: Object.keys(result),
          })
        } catch (genError: any) {
          console.error('generateCombinedAltText failed:', genError.message)
          console.error('Error stack:', genError.stack)
          // Return a partial result instead of throwing
          result = {
            url: normalizedUrl,
            pageAltText: `Error: ${genError.message}`,
            pageTopic: 'Error occurred',
            fuelUsed: undefined,
            imageUrl: undefined,
            imageAltText: undefined,
            imageDescription: undefined,
            imageWidth: undefined,
            imageHeight: undefined,
            imageSize: undefined,
          }
        }
        
        // Validate result structure
        if (!result || !result.url) {
          throw new Error('Invalid result structure from generateCombinedAltText')
        }
        
        const queryResult: QueryResult = {
          id: Date.now().toString(),
          url: result.url,
          timestamp: Date.now(),
          pageAltText: result.pageAltText || 'Unable to generate alt-text',
          pageTopic: result.pageTopic || 'Unable to determine topic',
          fuelUsed: result.fuelUsed,
          imageUrl: result.imageUrl,
          imageAltText: result.imageAltText,
          imageDescription: result.imageDescription,
          imageWidth: result.imageWidth,
          imageHeight: result.imageHeight,
          imageSize: result.imageSize,
          error: result.error,
          llmError: result.llmError,
        }
        
        console.log(`QueryResult created:`, {
          id: queryResult.id,
          url: queryResult.url,
          pageAltText: queryResult.pageAltText,
          pageTopic: queryResult.pageTopic,
          hasImageUrl: !!queryResult.imageUrl,
          imageUrl: queryResult.imageUrl,
          allKeys: Object.keys(queryResult),
        })

        // Add to history (at the beginning for newest first)
        queryHistory.unshift(queryResult)

        // Keep only last 50 queries
        if (queryHistory.length > 50) {
          queryHistory.pop()
        }

        return new Response(JSON.stringify(queryResult), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        })
      } catch (error: any) {
        return new Response(
          JSON.stringify({ error: error.message || 'Failed to process URL' }),
          {
            status: 500,
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          }
        )
      }
    }

    // 404
    return new Response('Not Found', {
      status: 404,
      headers: corsHeaders,
    })
  },
})

console.log('Server running at http://localhost:3000')

