# Testing Guide

This document describes how to test the agent-99 URL summarizer project.

## Prerequisites for Testing

1. **LM Studio Setup** (for local LLM):
   - Install [LM Studio](https://lmstudio.ai/)
   - Start LM Studio and load a model
   - Ensure the local server is running on `http://localhost:1234`

2. **Dependencies**:
   ```bash
   bun install
   ```

## Running Tests

### Manual Testing

#### Test 1: Basic URL Scraping and Summarization

```bash
bun run src/index.ts https://example.com
```

**Expected Result**:
- Successfully fetches the webpage
- Generates alt-text (50-150 characters)
- Displays topic summary
- Shows fuel usage

#### Test 2: Different Website Types

Test with various website types to ensure robustness:

```bash
# News article
bun run src/index.ts https://news.ycombinator.com

# Documentation site
bun run src/index.ts https://bun.sh

# Simple page
bun run src/index.ts https://example.com
```

**Expected Result**: Each should generate appropriate alt-text for the page type.

#### Test 3: Error Handling

Test error cases:

```bash
# Invalid URL
bun run src/index.ts https://this-domain-does-not-exist-12345.com

# Missing URL argument
bun run src/index.ts
```

**Expected Result**:
- Invalid URL: Should display an error message
- Missing argument: Should show usage instructions

### Automated Testing

#### Unit Test Structure

Create test files in a `tests/` directory:

```typescript
// tests/generateAltText.test.ts
import { describe, test, expect } from 'bun:test'
import { generateAltText } from '../src/index'

describe('generateAltText', () => {
  test('should generate alt-text for a valid URL', async () => {
    const result = await generateAltText('https://example.com')
    
    expect(result).toHaveProperty('url')
    expect(result).toHaveProperty('altText')
    expect(result).toHaveProperty('topic')
    expect(result).toHaveProperty('fuelUsed')
    
    expect(result.altText.length).toBeGreaterThan(50)
    expect(result.altText.length).toBeLessThan(150)
  }, { timeout: 30000 }) // LLM calls may take time
})
```

#### Running Tests

```bash
# Run all tests
bun test

# Run with coverage
bun test --coverage
```

## Test Cases to Implement

### Functional Tests

1. **Basic Functionality**
   - [x] Can fetch a simple webpage
   - [x] Generates valid alt-text output
   - [x] Alt-text is within 50-150 character range
   - [x] Topic is generated

2. **Edge Cases**
   - [x] Handles invalid URLs
   - [x] Handles 404 errors
   - [ ] Handles pages with minimal content
   - [ ] Handles pages with large amounts of content
   - [ ] Handles pages with non-English content
   - [ ] Handles redirects
   - [ ] Handles timeout scenarios

3. **Output Quality**
   - [ ] Alt-text is descriptive
   - [ ] Alt-text avoids redundant phrases
   - [ ] Alt-text is suitable for accessibility
   - [ ] Topic accurately describes page content

4. **Utility Functions**
   - [x] extractTextFromHTML removes HTML tags
   - [x] extractTextFromHTML removes script/style elements
   - [x] extractTextFromHTML decodes HTML entities
   - [x] extractTextFromHTML normalizes whitespace
   - [x] extractTextFromHTML limits length to 8000 characters
   - [x] extractTextFromHTML handles empty HTML
   - [x] extractTextFromHTML handles HTML with only tags

### Integration Tests

1. **Agent-99 Integration**
   - [ ] httpFetch atom works correctly
   - [ ] llmPredictBattery atom works correctly
   - [ ] Chain execution completes successfully
   - [ ] Fuel consumption is tracked

2. **LLM Integration**
   - [ ] Connects to LM Studio (if running)
   - [ ] Generates structured JSON output
   - [ ] Handles LLM errors gracefully

### Performance Tests

1. **Execution Time**
   - [ ] Typical execution completes in reasonable time (< 30s)
   - [ ] Fuel limits prevent runaway execution

2. **Resource Usage**
   - [ ] Memory usage is reasonable
   - [ ] No memory leaks in repeated executions

## Test Data

### Sample URLs for Testing

- **Simple**: `https://example.com`
- **Documentation**: `https://bun.sh/docs`
- **News**: `https://news.ycombinator.com`
- **Blog**: Various blog URLs
- **E-commerce**: Product pages (if accessible)

### Expected Output Format

```typescript
{
  url: string,
  altText: string,      // 50-150 characters
  topic: string,        // Brief description
  fuelUsed: number      // Execution cost
}
```

## Continuous Integration

For CI/CD, consider:

1. **Mock LLM Responses**: Use mocked capabilities instead of real LLM
2. **Test URLs**: Use stable, predictable test URLs
3. **Timeout Handling**: Set appropriate timeouts for network operations

## Troubleshooting

### Common Issues

1. **LM Studio Not Running**
   - Error: Connection refused to localhost:1234
   - Solution: Start LM Studio and ensure server is running

2. **Network Errors**
   - Error: Failed to fetch URL
   - Solution: Check internet connection and URL validity

3. **Fuel Exhausted**
   - Error: Execution exceeded fuel budget
   - Solution: Increase fuel limit in code or optimize the chain

4. **LLM Timeout**
   - Error: LLM call timed out
   - Solution: Increase timeout or use faster model

## Test Checklist

Before considering the project complete:

- [ ] All functional tests pass
- [ ] Error handling works correctly
- [ ] Output format is consistent
- [ ] Documentation is up to date
- [ ] Examples work as documented
- [ ] Performance is acceptable

