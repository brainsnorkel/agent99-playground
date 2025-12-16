# Agent-99 Atom and Pipeline Composition Analysis

## Executive Summary

The implementation has **mixed composition** - some functions properly use atoms and pipelines within the VM, while others violate agent-99's "agents-as-data" principle by executing logic outside the VM.

**Overall Assessment**: ⚠️ **Partially Compliant** - Needs refactoring to fully align with agent-99 principles.

---

## ✅ Well-Composed Functions (Properly Using Atoms/Pipelines)

### 1. `generateAltText()` - ✅ **EXCELLENT**

**Status**: Fully compliant with agent-99 principles

**Pipeline Structure**:
```typescript
const logic = b
  .httpFetch({ url: A99.args('url') })        // ✅ Atom: HTTP fetch inside VM
  .as('response')
  .varGet({ key: 'response.text' })
  .as('html')
  .htmlExtractText({ html: A99.args('html') }) // ✅ Atom: HTML processing inside VM
  .as('pageText')
  .varSet({ key: 'pageText', value: 'pageText' })
  .buildUserPrompt({ url: A99.args('url') })   // ✅ Atom: Prompt construction inside VM
  .as('userPrompt')
  .llmPredictBattery({ ... })                  // ✅ Atom: LLM call inside VM
  // ... rest of pipeline
```

**Strengths**:
- All operations execute within the VM
- Uses `httpFetch` atom for capability-based security
- Custom atoms (`htmlExtractText`, `buildUserPrompt`) properly defined
- Follows "agents-as-data" principle - logic compiled to AST
- Type-safe with proper schemas

---

## ❌ Functions Violating Agent-99 Principles

### 2. `generateImageAltText()` - ❌ **NEEDS REFACTORING**

**Status**: Only partially uses VM (final step only)

**Current Structure**:
```typescript
// ❌ OUTSIDE VM - Direct fetch
const response = await fetch(url)
const html = await response.text()

// ❌ OUTSIDE VM - Image extraction
const images = extractImagesFromHTML(html, url)

// ❌ OUTSIDE VM - Filtering
const candidates = filterCandidateImages(images, 3)

// ❌ OUTSIDE VM - Parallel image fetching
const candidateData = await Promise.all(
  candidates.map(async (img) => {
    const imageData = await fetchImageData(img.url) // Direct fetch
    // ...
  })
)

// ❌ OUTSIDE VM - Scoring (uses direct predictWithVision)
const scoredCandidates = await Promise.all(
  validCandidates.map(async ({ img, imageData }) => {
    const score = await scoreImageInterestingness(...) // Direct API call
    // ...
  })
)

// ✅ INSIDE VM - Only final alt-text generation
const logic = b.llmVisionBattery({ ... })
```

**Issues**:
1. **HTTP fetching outside VM**: Uses `fetch()` instead of `httpFetch` atom
2. **Image extraction outside VM**: `extractImagesFromHTML()` should be an atom
3. **Image filtering outside VM**: `filterCandidateImages()` should be an atom
4. **Image fetching outside VM**: `fetchImageData()` should use `httpFetch` atom
5. **Scoring outside VM**: `scoreImageInterestingness()` uses direct `predictWithVision()` instead of VM

**Impact**:
- Bypasses capability-based security
- No fuel tracking for most operations
- Logic not serializable to AST
- Reduces type safety
- Makes workflow less portable

---

### 3. `generateCombinedAltText()` - ❌ **NEEDS REFACTORING**

**Status**: Mixed - page alt-text uses VM, image processing doesn't

**Current Structure**:
```typescript
// ❌ OUTSIDE VM - Direct fetch
const response = await fetch(url)
const html = await response.text()

// ❌ OUTSIDE VM - Image extraction
const images = extractImagesFromHTML(html, url)

// ❌ OUTSIDE VM - Text extraction
const pageText = extractTextFromHTML(html)

// ✅ INSIDE VM - Page alt-text generation
const pageLogic = b.llmPredictBattery({ ... })

// ❌ OUTSIDE VM - All image processing (same issues as generateImageAltText)
// ... filtering, fetching, scoring all outside VM

// ✅ INSIDE VM - Only final image alt-text generation
const imageLogic = b.llmVisionBattery({ ... })
```

**Issues**: Same as `generateImageAltText()` plus:
- Text extraction happens outside VM (should use `htmlExtractText` atom in pipeline)

---

### 4. `scoreImageInterestingness()` - ❌ **SHOULD BE ATOMIC**

**Status**: Uses direct API call instead of VM

**Current Implementation**:
```typescript
async function scoreImageInterestingness(...) {
  // ❌ Direct API call outside VM
  const llmResponse = await predictWithVision(
    llmBaseUrl,
    systemPrompt,
    userPrompt,
    imageDataUri,
    responseFormat
  )
  // ...
}
```

**Should Be**: An atom or part of a pipeline using `llmVisionBattery`

---

## 🔧 Functions That Should Be Atoms

### 5. `extractImagesFromHTML()` - ⚠️ **SHOULD BE ATOM**

**Current**: Regular function called outside VM

**Should Be**:
```typescript
const extractImagesFromHTMLAtom = defineAtom(
  'extractImagesFromHTML',
  s.object({ html: s.string, baseUrl: s.string }),
  s.array(s.object({
    url: s.string,
    width: s.number.optional(),
    height: s.number.optional(),
    alt: s.string.optional(),
    area: s.number.optional(),
  })),
  async ({ html, baseUrl }, ctx) => {
    // ... extraction logic
  },
  { docs: 'Extract image information from HTML', cost: 5 }
)
```

---

### 6. `filterCandidateImages()` - ⚠️ **SHOULD BE ATOM**

**Current**: Regular function called outside VM

**Should Be**:
```typescript
const filterCandidateImagesAtom = defineAtom(
  'filterCandidateImages',
  s.object({ 
    images: s.array(s.object({ ... })),
    maxCandidates: s.number.optional()
  }),
  s.array(s.object({ ... })),
  async ({ images, maxCandidates }, ctx) => {
    // ... filtering logic
  },
  { docs: 'Filter images to candidates larger than icon size', cost: 1 }
)
```

---

### 7. `fetchImageData()` - ⚠️ **SHOULD USE HTTPFETCH ATOM**

**Current**: Direct `fetch()` call outside VM

**Should Be**: Use `httpFetch` atom within a pipeline:
```typescript
const logic = b
  .httpFetch({ url: A99.args('imageUrl') })
  .as('response')
  .varGet({ key: 'response.arrayBuffer' })
  // ... convert to base64
```

---

## 📊 Composition Scorecard

| Function | VM Usage | Atoms Used | Pipeline | Score |
|----------|----------|------------|----------|-------|
| `generateAltText()` | ✅ Full | ✅ Yes | ✅ Yes | 🟢 **100%** |
| `generateImageAltText()` | ⚠️ Partial | ⚠️ Partial | ❌ No | 🔴 **20%** |
| `generateCombinedAltText()` | ⚠️ Partial | ⚠️ Partial | ⚠️ Partial | 🟡 **40%** |
| `scoreImageInterestingness()` | ❌ None | ❌ None | ❌ No | 🔴 **0%** |
| `extractImagesFromHTML()` | ❌ None | ❌ None | ❌ No | 🔴 **0%** |
| `filterCandidateImages()` | ❌ None | ❌ None | ❌ No | 🔴 **0%** |
| `fetchImageData()` | ❌ None | ❌ None | ❌ No | 🔴 **0%** |

---

## 🎯 Recommended Refactoring Strategy

### Phase 1: Create Missing Atoms

1. **`extractImagesFromHTMLAtom`**
   - Convert `extractImagesFromHTML()` to atom
   - Register in VM

2. **`filterCandidateImagesAtom`**
   - Convert `filterCandidateImages()` to atom
   - Register in VM

3. **`fetchImageDataAtom`** (or use `httpFetch` directly)
   - Create atom that uses `httpFetch` internally
   - Handles base64 conversion

4. **`scoreImageInterestingnessAtom`**
   - Create atom that uses `llmVisionBattery` internally
   - Or integrate scoring into main pipeline

### Phase 2: Refactor Functions to Use Pipelines

1. **Refactor `generateImageAltText()`**:
```typescript
const logic = b
  .httpFetch({ url: A99.args('url') })
  .as('response')
  .varGet({ key: 'response.text' })
  .as('html')
  .extractImagesFromHTML({ html: A99.args('html'), baseUrl: A99.args('url') })
  .as('images')
  .filterCandidateImages({ images: A99.args('images'), maxCandidates: 3 })
  .as('candidates')
  // ... fetch and score images in pipeline
  .llmVisionBattery({ ... })
```

2. **Refactor `generateCombinedAltText()`**:
   - Similar approach - move all logic into pipeline
   - Use single pipeline for both page and image processing

### Phase 3: Benefits After Refactoring

✅ **Full capability-based security** - All HTTP calls go through `httpFetch`  
✅ **Fuel tracking** - All operations tracked in VM  
✅ **Serializable logic** - Entire workflow compiles to AST  
✅ **Type safety** - All operations have input/output schemas  
✅ **Portability** - Workflow can be serialized, stored, and replayed  
✅ **Testability** - Can test pipelines independently  
✅ **Composability** - Atoms can be reused in other workflows  

---

## 🔍 Key Agent-99 Principles Checklist

| Principle | Current Status | Notes |
|-----------|---------------|-------|
| **Agents-as-data** | ⚠️ Partial | Only `generateAltText()` fully compliant |
| **Functions-as-schemas** | ✅ Good | Atoms have proper schemas |
| **Safe-by-design** | ⚠️ Partial | Some operations bypass capability checks |
| **Fuel limits** | ⚠️ Partial | Only VM operations tracked |
| **Isolated execution** | ⚠️ Partial | Some logic executes outside VM |

---

## 📝 Conclusion

The codebase demonstrates **good understanding** of agent-99 principles in `generateAltText()`, but **needs significant refactoring** to fully align with the "agents-as-data" philosophy. The image processing functions (`generateImageAltText()`, `generateCombinedAltText()`) execute most logic outside the VM, which:

1. Reduces security (bypasses capability checks)
2. Reduces observability (no fuel tracking)
3. Reduces portability (logic not serializable)
4. Reduces type safety (no schema validation)

**Priority**: High - Refactor image processing functions to use atoms and pipelines within the VM.

