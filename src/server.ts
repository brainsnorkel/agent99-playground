import { serve } from 'bun'
import { generateAltText } from './index'

interface QueryResult {
  id: string
  url: string
  altText: string
  topic: string
  fuelUsed: number
  timestamp: number
}

// In-memory storage (in production, use a database)
const queryHistory: QueryResult[] = []
const defaultLLMUrl = 'http://192.168.1.61:1234/v1'

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

        // Use provided LLM URL or default
        const effectiveLLMUrl = llmUrl || defaultLLMUrl
        const finalLLMUrl = effectiveLLMUrl.endsWith('/v1')
          ? effectiveLLMUrl
          : `${effectiveLLMUrl}/v1`

        // Process the URL
        const result = await generateAltText(targetUrl, finalLLMUrl)

        // Create query result
        const queryResult: QueryResult = {
          id: Date.now().toString(),
          url: result.url,
          altText: result.altText,
          topic: result.topic,
          fuelUsed: result.fuelUsed,
          timestamp: Date.now(),
        }

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

