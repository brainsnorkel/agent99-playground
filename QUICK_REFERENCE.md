# Agent-99 Quick Reference

A quick reference guide for idiomatic agent-99 patterns used in this project.

## Core Pattern: Complete Pipeline

```typescript
// 1. Create VM
const vm = createVM()
const b = vm.A99

// 2. Build pipeline
const logic = b
  .httpFetch({ url: A99.args('url') })
  .as('response')
  .varGet({ key: 'response.text' })
  .as('html')
  .myCustomAtom({ input: A99.args('html') })
  .as('result')
  .return(s.object({ output: s.string }))

// 3. Compile to AST
const ast = logic.toJSON()

// 4. Execute in VM
const result = await vm.run(
  ast,
  { url: 'https://example.com' },
  {
    fuel: 10000,
    capabilities: { ...batteries, fetch },
  }
)
```

## Common Pipeline Operations

| Operation | Usage | Description |
|-----------|-------|-------------|
| `.httpFetch({ url })` | Fetch HTTP resources | Capability-based HTTP requests |
| `.as('alias')` | Create alias | Reference result in later steps |
| `.varGet({ key })` | Get variable | Access stored values |
| `.varSet({ key, value })` | Set variable | Store values for later |
| `.jsonParse({ str })` | Parse JSON | Convert JSON string to object |
| `.return(schema)` | Define output | Final output schema |

## Custom Atom Template

```typescript
const myAtom = defineAtom(
  'myAtom',                    // Name
  s.object({ input: s.string }), // Input schema
  s.object({ output: s.string }), // Output schema
  async ({ input }, ctx) => {
    // Access capabilities
    const fetchCap = ctx.capabilities.fetch
    const llmCap = ctx.capabilities.llm
    
    // Access variables
    const stored = ctx.vars?.myKey
    
    // Implementation
    return { output: input.toUpperCase() }
  },
  { 
    docs: 'Description',
    cost: 10,
    timeoutMs: 5000,
  }
)
```

## Argument Passing

```typescript
// Pass arguments
vm.run(ast, { url, pageContext }, { fuel, capabilities })

// Access in pipeline
.httpFetch({ url: A99.args('url') })
.process({ context: A99.args('pageContext') })
```

## Variable Management

```typescript
// Store
.varSet({ key: 'myKey', value: 'myValue' })
.varSet({ key: 'result', value: 'currentResult' })

// Retrieve
.varGet({ key: 'myKey' })
.varGet({ key: 'response.text' })  // Nested access
```

## Error Handling

```typescript
// In atom
async ({ input }, ctx) => {
  try {
    return await primaryOperation()
  } catch (error) {
    return fallbackValue
  }
}

// In execution
try {
  const result = await vm.run(ast, args, options)
} catch (vmError) {
  console.error('VM failed:', vmError.message)
  throw vmError
}
```

## Capability Setup

```typescript
// Standard
const capabilities = batteries

// Custom
const customCapabilities = {
  ...batteries,
  fetch: customFetch,
  llm: {
    predict: customPredict,
    predictWithVision: customVision,
  },
}

// Execute
vm.run(ast, args, { capabilities: customCapabilities })
```

## Schema Patterns

```typescript
// Required fields
s.object({
  url: s.string,
  count: s.number,
})

// Optional fields
s.object({
  url: s.string,
  width: s.any,  // Use s.any for optional
  height: s.any,
})

// Arrays
s.array(s.object({ ... }))

// Nested objects
s.object({
  data: s.object({
    nested: s.string,
  }),
})
```

## Common Patterns

### Fetch → Process → LLM

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
  .return(s.object({ result: s.string }))
```

### Extract → Filter → Process

```typescript
const logic = b
  .extractItems({ source: A99.args('source') })
  .as('items')
  .filterItems({ items: A99.args('items') })
  .as('filtered')
  .processItems({ items: A99.args('filtered') })
  .return(s.object({ results: s.array(...) }))
```

## Checklist: Is My Code Idiomatic?

- [ ] All logic compiles to AST before execution
- [ ] All HTTP calls use `httpFetch` atom
- [ ] All operations execute within VM
- [ ] Custom atoms have input/output schemas
- [ ] Capabilities are explicitly provided
- [ ] Fuel is tracked for all operations
- [ ] Error handling includes fallbacks
- [ ] Variables are used for intermediate values
- [ ] Pipeline uses `.return()` with schema

## Anti-Patterns to Avoid

❌ **Direct fetch() calls** → ✅ Use `httpFetch` atom  
❌ **Logic outside VM** → ✅ All logic in pipeline  
❌ **Missing schemas** → ✅ Define input/output schemas  
❌ **Global access** → ✅ Use capabilities  
❌ **Untracked operations** → ✅ All in VM with fuel  

## Project-Specific Atoms

This project defines these custom atoms:

- `htmlExtractText` - Extract text from HTML
- `extractImagesFromHTML` - Extract image info
- `filterCandidateImages` - Filter by size
- `processCandidateImages` - Fetch and score in parallel
- `scoreImageInterestingness` - Score with LLM vision
- `fetchImageData` - Fetch image with base64
- `buildUserPrompt` - Build LLM prompts
- `llmPredictBatteryLongTimeout` - LLM with long timeout
- `llmVisionBattery` - Vision-capable LLM

## See Also

- [README.md](./README.md) - Full documentation with examples
- [AGENT99_PATTERNS.md](./AGENT99_PATTERNS.md) - Detailed patterns guide
- [ATOM_PIPELINE_ANALYSIS.md](./ATOM_PIPELINE_ANALYSIS.md) - Architecture analysis

