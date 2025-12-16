# Agent-99 Idiomatic Patterns Guide

This document explains the idiomatic approach to building applications with agent-99, using examples from this project.

## Table of Contents

1. [Core Principles](#core-principles)
2. [Pipeline Composition](#pipeline-composition)
3. [Custom Atoms](#custom-atoms)
4. [Variable Management](#variable-management)
5. [Error Handling](#error-handling)
6. [Capability-Based Security](#capability-based-security)
7. [Common Patterns](#common-patterns)
8. [Anti-Patterns to Avoid](#anti-patterns-to-avoid)

## Core Principles

### 1. Agents-as-Data

**✅ DO**: Compile all logic to JSON AST before execution

```typescript
const logic = b
  .httpFetch({ url: A99.args('url') })
  .htmlExtractText({ html: A99.args('html') })
  // ... more steps

const ast = logic.toJSON()  // Compile to AST
const result = await vm.run(ast, { url }, { fuel: 10000, capabilities })
```

**❌ DON'T**: Execute logic directly outside the VM

```typescript
// ❌ BAD: Direct execution outside VM
const response = await fetch(url)
const html = await response.text()
const text = extractTextFromHTML(html)
```

### 2. Functions-as-Schemas

**✅ DO**: Define input/output schemas for all atoms

```typescript
const myAtom = defineAtom(
  'myAtom',
  s.object({ input: s.string }),  // Input schema
  s.object({ output: s.string }), // Output schema
  async ({ input }, ctx) => {
    return { output: input.toUpperCase() }
  },
  { docs: 'Description', cost: 1 }
)
```

**❌ DON'T**: Use untyped functions

```typescript
// ❌ BAD: No schemas
async function myFunction(input: string) {
  return input.toUpperCase()
}
```

### 3. Safe-by-Design

**✅ DO**: Use capability-based security

```typescript
// Provide explicit capabilities
const capabilities = {
  fetch: batteries.fetch || fetch,
  llm: customLLMCapability,
}

const result = await vm.run(ast, args, { capabilities })
```

**❌ DON'T**: Access global resources directly

```typescript
// ❌ BAD: Direct global access
const response = await fetch(url)  // Bypasses capability system
```

## Pipeline Composition

### Basic Pipeline Structure

```typescript
const vm = createVM()
const b = vm.A99

const logic = b
  // Step 1: Initial operation
  .httpFetch({ url: A99.args('url') })
  .as('response')  // Alias for later reference
  
  // Step 2: Transform data
  .varGet({ key: 'response.text' })
  .as('html')
  
  // Step 3: Process with custom atom
  .htmlExtractText({ html: A99.args('html') })
  .as('pageText')
  
  // Step 4: Store for later use
  .varSet({ key: 'pageText', value: 'pageText' })
  
  // Step 5: Use stored value
  .buildUserPrompt({ url: A99.args('url') })
  .as('userPrompt')
  
  // Step 6: LLM call
  .llmPredictBattery({
    system: '...',
    user: A99.args('userPrompt'),
    responseFormat: { ... }
  })
  .as('summary')
  
  // Step 7: Parse result
  .varGet({ key: 'summary.content' })
  .as('jsonContent')
  .jsonParse({ str: 'jsonContent' })
  .as('parsed')
  
  // Step 8: Return structured output
  .return(
    s.object({
      altText: s.string,
      topic: s.string,
    })
  )

// Compile and execute
const ast = logic.toJSON()
const result = await vm.run(ast, { url }, { fuel: 10000, capabilities })
```

### Using Arguments

```typescript
// Pass arguments to pipeline
const result = await vm.run(
  ast,
  { 
    url: 'https://example.com',
    pageContext: { altText: '...', topic: '...' }
  },
  { fuel: 10000, capabilities }
)

// Access in pipeline
.httpFetch({ url: A99.args('url') })
.processCandidateImages({
  candidates: A99.args('candidates'),
  pageContext: A99.args('pageContext'),
})
```

### Chaining Operations

```typescript
const logic = b
  .operation1({ param: A99.args('input') })
  .as('step1')
  .operation2({ data: A99.args('step1') })
  .as('step2')
  .operation3({ 
    step1: A99.args('step1'),
    step2: A99.args('step2')
  })
  .return(s.object({ result: s.string }))
```

## Custom Atoms

### Defining Custom Atoms

```typescript
const myCustomAtom = defineAtom(
  'myCustomAtom',                    // Atom name
  s.object({                          // Input schema
    input: s.string,
    optional: s.any,
  }),
  s.object({                          // Output schema
    output: s.string,
    count: s.number,
  }),
  async ({ input, optional }, ctx) => {
    // Implementation
    // Access capabilities via ctx.capabilities
    const fetchCap = ctx.capabilities.fetch
    
    // Access variables via ctx.vars
    const storedValue = ctx.vars?.myKey
    
    return {
      output: input.toUpperCase(),
      count: input.length,
    }
  },
  { 
    docs: 'Description of what this atom does',
    cost: 10,           // Fuel cost
    timeoutMs: 5000,    // Timeout in milliseconds
  }
)
```

### Registering Atoms

```typescript
function createVM() {
  return new AgentVM({
    myCustomAtom,              // Register custom atom
    htmlExtractText,           // Register other atoms
    extractImagesFromHTML,
    // ... more atoms
  })
}
```

### Using Custom Atoms in Pipelines

```typescript
const logic = b
  .httpFetch({ url: A99.args('url') })
  .as('response')
  .varGet({ key: 'response.text' })
  .as('html')
  .myCustomAtom({              // Use custom atom
    input: A99.args('html'),
    optional: undefined,
  })
  .as('result')
  .return(s.object({ ... }))
```

## Variable Management

### Storing Values

```typescript
.varSet({ key: 'pageText', value: 'pageText' })
.varSet({ key: 'url', value: A99.args('url') })
```

### Retrieving Values

```typescript
.varGet({ key: 'response.text' })        // Nested property access
.varGet({ key: 'pageText' })             // Simple key access
.varGet({ key: 'summary.content' })      // Dot notation
```

### Using Aliases

```typescript
.operation()
.as('alias')              // Create alias for current result
.anotherOperation({ 
  data: A99.args('alias')  // Reference alias
})
```

## Error Handling

### Within Atoms

```typescript
const myAtom = defineAtom(
  'myAtom',
  inputSchema,
  outputSchema,
  async ({ input }, ctx) => {
    try {
      // Primary operation
      const result = await ctx.capabilities.llm.predict(...)
      return result
    } catch (error) {
      // Fallback logic
      console.warn('Primary operation failed, using fallback')
      return fallbackValue
    }
  },
  { docs: '...', cost: 10 }
)
```

### In Pipeline Execution

```typescript
try {
  const result = await vm.run(ast, args, { fuel: 10000, capabilities })
  // Process result
} catch (vmError: any) {
  console.error('VM execution failed:', vmError.message)
  // Handle error
  throw vmError
}
```

## Capability-Based Security

### Providing Capabilities

```typescript
// Standard batteries
const capabilities = batteries

// Custom capabilities
const customCapabilities = {
  ...batteries,
  llm: {
    predict: async (system, user, tools, responseFormat) => {
      // Custom LLM implementation
    },
    predictWithVision: async (system, userText, imageDataUri, responseFormat) => {
      // Custom vision implementation
    },
  },
  fetch: customFetchImplementation,
}

// Execute with capabilities
const result = await vm.run(ast, args, { capabilities: customCapabilities })
```

### Accessing Capabilities in Atoms

```typescript
const myAtom = defineAtom(
  'myAtom',
  inputSchema,
  outputSchema,
  async ({ input }, ctx) => {
    // Access capabilities from context
    const fetchCap = ctx.capabilities.fetch
    const llmCap = ctx.capabilities.llm
    
    if (!fetchCap) {
      throw new Error("Capability 'fetch' missing")
    }
    
    const response = await fetchCap(input.url)
    return { result: await response.text() }
  },
  { docs: '...', cost: 10 }
)
```

## Common Patterns

### Pattern 1: Fetch → Process → LLM

```typescript
const logic = b
  .httpFetch({ url: A99.args('url') })
  .as('response')
  .varGet({ key: 'response.text' })
  .as('html')
  .processHTML({ html: A99.args('html') })
  .as('processed')
  .llmPredictBattery({
    system: '...',
    user: A99.args('processed'),
    responseFormat: { ... }
  })
  .as('result')
  .return(s.object({ ... }))
```

### Pattern 2: Extract → Filter → Process

```typescript
const logic = b
  .extractItems({ source: A99.args('source') })
  .as('items')
  .filterItems({ 
    items: A99.args('items'),
    criteria: A99.args('criteria')
  })
  .as('filtered')
  .processItems({ items: A99.args('filtered') })
  .as('processed')
  .return(s.object({ ... }))
```

### Pattern 3: Parallel Processing in Atom

```typescript
const processMultipleAtom = defineAtom(
  'processMultiple',
  s.object({ items: s.array(s.string) }),
  s.array(s.object({ result: s.string })),
  async ({ items }, ctx) => {
    // Parallel processing inside atom
    const results = await Promise.all(
      items.map(async (item) => {
        const result = await processItem(item, ctx)
        return { result }
      })
    )
    return results
  },
  { docs: 'Process multiple items in parallel', cost: items.length * 10 }
)
```

### Pattern 4: Conditional Logic

```typescript
const logic = b
  .checkCondition({ input: A99.args('input') })
  .as('condition')
  .varGet({ key: 'condition.met' })
  .as('isMet')
  // Use conditional value in next step
  .processConditionally({
    input: A99.args('input'),
    condition: A99.args('isMet')
  })
  .return(s.object({ ... }))
```

## Anti-Patterns to Avoid

### ❌ Anti-Pattern 1: Direct API Calls Outside VM

```typescript
// ❌ BAD: Direct fetch outside VM
export async function badFunction(url: string) {
  const response = await fetch(url)  // Bypasses capability system
  const html = await response.text()
  // Process outside VM...
}

// ✅ GOOD: Use httpFetch atom in pipeline
export async function goodFunction(url: string) {
  const logic = b
    .httpFetch({ url: A99.args('url') })
    // ... process in VM
  const ast = logic.toJSON()
  return await vm.run(ast, { url }, { capabilities })
}
```

### ❌ Anti-Pattern 2: Imperative Logic Outside Pipeline

```typescript
// ❌ BAD: Imperative logic outside VM
const images = extractImagesFromHTML(html, url)
const filtered = filterCandidateImages(images, 3)
const processed = await Promise.all(filtered.map(process))

// ✅ GOOD: All logic in pipeline
const logic = b
  .extractImagesFromHTML({ html: A99.args('html'), baseUrl: A99.args('url') })
  .filterCandidateImages({ images: A99.args('images'), maxCandidates: 3 })
  .processCandidateImages({ candidates: A99.args('candidates') })
```

### ❌ Anti-Pattern 3: Missing Schemas

```typescript
// ❌ BAD: No input/output schemas
const badAtom = defineAtom(
  'badAtom',
  s.any,  // No type safety
  s.any,  // No type safety
  async (input: any) => {  // Untyped
    return input
  }
)

// ✅ GOOD: Proper schemas
const goodAtom = defineAtom(
  'goodAtom',
  s.object({ input: s.string }),  // Type-safe input
  s.object({ output: s.string }), // Type-safe output
  async ({ input }: { input: string }, ctx) => {
    return { output: input.toUpperCase() }
  }
)
```

### ❌ Anti-Pattern 4: Bypassing Fuel System

```typescript
// ❌ BAD: Operations not tracked in fuel
const result = await someAsyncOperation()  // Not in VM

// ✅ GOOD: All operations in VM with fuel tracking
const logic = b
  .myAtom({ input: A99.args('input') })  // Tracked in fuel
  .return(s.object({ ... }))
```

## Best Practices Summary

1. ✅ **Always use pipelines** - Compile logic to AST before execution
2. ✅ **Define schemas** - Every atom needs input/output schemas
3. ✅ **Use capabilities** - Never access globals directly
4. ✅ **Track fuel** - All operations should consume fuel
5. ✅ **Handle errors** - Provide fallbacks in atoms
6. ✅ **Document atoms** - Include descriptions and cost estimates
7. ✅ **Compose pipelines** - Build complex workflows from simple atoms
8. ✅ **Use variables** - Store intermediate values for reuse

## Examples from This Project

See the following files for complete examples:

- **`src/index.ts`**: 
  - `generateAltText()` - Complete page alt-text pipeline
  - `generateImageAltText()` - Image processing pipeline
  - `generateCombinedAltText()` - Combined page and image pipeline
  - Custom atom definitions (lines 1184-1620)

- **Test file**: `src/example.test.ts` - Examples of using the functions

