import { describe, test, expect } from 'bun:test'
import { generateAltText } from './index'

describe('generateAltText', () => {
  test('should generate alt-text for a valid URL', async () => {
    // Note: This test requires LM Studio to be running
    // Skip if not available
    const result = await generateAltText('https://example.com')
    
    expect(result).toHaveProperty('url')
    expect(result).toHaveProperty('altText')
    expect(result).toHaveProperty('topic')
    expect(result).toHaveProperty('fuelUsed')
    
    expect(typeof result.url).toBe('string')
    expect(typeof result.altText).toBe('string')
    expect(typeof result.topic).toBe('string')
    expect(typeof result.fuelUsed).toBe('number')
    
    // Alt-text should be within reasonable length
    expect(result.altText.length).toBeGreaterThan(20)
    expect(result.altText.length).toBeLessThan(200)
    
    // Topic should be present
    expect(result.topic.length).toBeGreaterThan(0)
    
    // Fuel should be consumed
    expect(result.fuelUsed).toBeGreaterThan(0)
  }, { timeout: 60000 }) // LLM calls may take time
})

