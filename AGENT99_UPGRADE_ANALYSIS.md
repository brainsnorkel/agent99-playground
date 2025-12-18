# Agent-99 Upgrade Analysis: 0.0.1 → 0.0.3

## Executive Summary

A new version of agent-99 (0.0.3) has been released with **breaking API changes** that require updates to this codebase. This document details all necessary changes to migrate from version 0.0.1 to 0.0.3.

## Version Timeline

| Version | Release Date | Key Changes |
|---------|-------------|-------------|
| 0.0.1 | Dec 16, 2025 | Initial release |
| 0.0.2 | Dec 16, 2025 | Safety improvements, `.A99` property on VM, `hash` atom |
| 0.0.3 | Dec 17, 2025 | **Breaking**: `batteryAtoms` replaces individual imports, dependency restructuring |

## Breaking Changes

### 1. Battery Atom Registration (HIGH PRIORITY)

**What Changed:** Individual battery exports (`storeVectorize`, `storeSearch`, `llmPredictBattery`) have been consolidated into a single `batteryAtoms` object.

**Old API (0.0.1):**
```typescript
import {
  AgentVM,
  batteries,
  storeVectorize,
  storeSearch,
  llmPredictBattery,
  A99,
  defineAtom,
} from 'agent-99'

const vm = new AgentVM({
  storeVectorize,
  storeSearch,
  llmPredictBattery,
  // ... custom atoms
})
```

**New API (0.0.3):**
```typescript
import {
  AgentVM,
  batteries,
  batteryAtoms,
  A99,
  defineAtom,
} from 'agent-99'

const vm = new AgentVM({
  ...batteryAtoms,
  // ... custom atoms (can override battery atoms)
})
```

### 2. Dependency Changes

**0.0.1/0.0.2 Dependencies:**
- `jsep: ^1.4.0`
- `@orama/orama: ^3.1.17` (bundled)
- `@xenova/transformers: ^2.17.2` (bundled)
- `tosijs-schema: 1.0.1`

**0.0.3 Dependencies:**
- `jsep: ^1.4.0`
- `tosijs-schema: 1.0.1`

**Impact:** `@orama/orama` and `@xenova/transformers` are no longer direct dependencies. Agent-99 now has its own internal vector search implementation. These packages are lazy-loaded only when needed.

### 3. New Features Available

- **`vm.getTools()`** - Self-documentation method returning OpenAI-compatible tool schemas
- **Internal vector search** - Custom cosine similarity implementation (benchmarks: 10K vectors × 500 dims in ~15ms)
- **Automatic LM Studio detection** - Auto-audits available models

---

## Required Code Changes

### File: `src/index.ts`

#### Change 1: Update Imports (Line 1-9)

**Current:**
```typescript
import {
  AgentVM,
  batteries,
  storeVectorize,
  storeSearch,
  llmPredictBattery,
  A99,
  defineAtom,
} from 'agent-99'
```

**New:**
```typescript
import {
  AgentVM,
  batteries,
  batteryAtoms,
  A99,
  defineAtom,
} from 'agent-99'
```

#### Change 2: Update `createVM()` Function (Lines 2394-2409)

**Current:**
```typescript
function createVM() {
  return new AgentVM({
    storeVectorize,
    storeSearch,
    llmPredictBattery: llmPredictBatteryLongTimeout,
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
```

**New:**
```typescript
function createVM() {
  return new AgentVM({
    ...batteryAtoms,
    // Override battery atoms with custom implementations
    llmPredictBattery: llmPredictBatteryLongTimeout,
    // Custom atoms
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
```

---

### File: `package.json`

**Current:**
```json
{
  "dependencies": {
    "agent-99": "^0.0.1",
    "tosijs-schema": "^1.0.1"
  }
}
```

**New:**
```json
{
  "dependencies": {
    "agent-99": "^0.0.3",
    "tosijs-schema": "^1.0.1"
  }
}
```

---

### Documentation Files to Update

The following documentation files contain outdated import patterns and should be updated:

| File | Lines to Update | Description |
|------|-----------------|-------------|
| `docs/AGENT99_CONTEXT.md` | Lines 73-83 | Old battery import examples |
| `README.md` | Lines 173+ | `createVM()` example |
| `AGENT99_PATTERNS.md` | Lines 219+ | VM instantiation pattern |
| `QUICK_REFERENCE.md` | Lines 179+ | Pipeline examples |

---

## Migration Steps

### Step 1: Update Dependencies

```bash
# Update package.json to use ^0.0.3
bun install agent-99@^0.0.3
```

### Step 2: Update Source Code

Apply the import and `createVM()` changes in `src/index.ts` as described above.

### Step 3: Run Tests

```bash
bun test
```

### Step 4: Update Documentation

Update all documentation files to reflect the new API patterns.

### Step 5: Verify LM Studio Integration

The new version has improved LM Studio auto-detection. Verify:
```bash
bun run start https://example.com
```

---

## Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| Breaking import changes | **High** | Direct code changes required |
| Battery functionality regression | Medium | Test vector search and LLM prediction thoroughly |
| Documentation mismatch | Low | Update docs after code migration |

---

## Verification Checklist

After migration, verify the following:

- [ ] Application compiles without TypeScript errors
- [ ] `bun test` passes all tests
- [ ] URL summarization works: `bun run start <url>`
- [ ] Image alt-text generation works: `bun run start --image <url>`
- [ ] Web server works: `bun run dev`
- [ ] Vision atom tests pass: `testVisionAtom()` function
- [ ] Custom atoms (`llmPredictBatteryLongTimeout`, `llmVisionBattery`) work correctly

---

## Additional Notes

### New `getTools()` Feature

The new version includes a self-documentation feature that can be useful for LLM tool calling:

```typescript
const vm = createVM()
const allTools = vm.getTools()           // Get all available tools
const flowTools = vm.getTools('flow')    // Get tools in 'flow' category
const specific = vm.getTools(['httpFetch', 'mathCalc'])  // Get specific tools
```

This returns OpenAI-compatible Tool Schema for function calling integration.

### Performance Improvements

The new internal vector search implementation provides:
- 10,000 vectors × 500 dimensions: ~15ms
- 10,000 vectors × 1,000 dimensions: ~22ms
- 100,000 vectors × 500 dimensions: ~101ms

---

## Sources

- [agent-99 npm package](https://www.npmjs.com/package/agent-99)
- [GitHub Repository: tonioloewald/agent-99](https://github.com/tonioloewald/agent-99)
