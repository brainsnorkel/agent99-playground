# Agent-99 Code Review

## Review Date
2025-01-XX

## Design Philosophy Alignment

Agent-99 follows these core principles:
- **Functions-as-schemas**: All operations are type-safe with input/output schemas
- **Agents-as-data**: Logic is compiled to JSON AST before execution
- **Safe-by-design**: Capability-based security, fuel limits, isolated VM execution

## Issues Found

### 1. ❌ Mixed Execution Models (High Priority)

**Issue**: `generateAltText()` and `generateCombinedAltText()` fetch HTML outside the VM using regular `fetch()`, then pass data into the VM. This violates the "agents-as-data" principle.

**Current Pattern**:
```typescript
// Outside VM
const response = await fetch(url)
const html = await response.text()
const pageText = extractTextFromHTML(html)

// Then pass to VM
const logic = b.llmPredictBattery({ user: `...${pageText}...` })
```

**Should Be**:
```typescript
// Inside VM using httpFetch atom
const logic = b
  .httpFetch({ url: A99.args('url') })
  .as('html')
  // ... process in VM
```

**Impact**: Reduces type safety, bypasses capability-based security, makes the workflow less portable.

### 2. ❌ Direct API Calls Instead of VM Execution (High Priority)

**Issue**: `predictWithVision()` is called directly instead of using the VM execution model. The code even has a TODO comment acknowledging this.

**Location**: `generateImageAltText()`, `generateCombinedAltText()`

**Current Pattern**:
```typescript
const llmResponse = await predictWithVision(
  finalLlmUrl,
  systemPrompt,
  userPrompt,
  imageData.base64,
  responseFormat
)
```

**Should Be**:
```typescript
const logic = b
  .llmVisionBattery({
    system: systemPrompt,
    userText: userPrompt,
    imageDataUri: A99.args('imageDataUri'),
    responseFormat,
  })
  // ... rest of pipeline
```

**Impact**: Inconsistent execution model, bypasses fuel limits, reduces type safety.

### 3. ⚠️ Variable Access Patterns (Medium Priority)

**Issue**: `varSet()` uses string paths like `'parsed.altText'` which may work but might not be the most idiomatic pattern.

**Current Pattern**:
```typescript
.varSet({ key: 'altText', value: 'parsed.altText' })
```

**Consideration**: According to agent-99 docs, when referencing runtime values in expressions, you should use `A99.args()`. However, `varSet` might accept string paths directly. Need to verify the correct pattern.

**Impact**: May work but could be more explicit about variable references.

### 4. ⚠️ Missing httpFetch Usage (Medium Priority)

**Issue**: README claims the project uses `httpFetch` atom, but the code uses regular `fetch()` outside the VM.

**Impact**: Documentation mismatch, missed opportunity to demonstrate capability-based security.

### 5. ✅ Custom Atoms (Good)

**Status**: Custom atoms (`llmPredictBatteryLongTimeout`, `llmVisionBattery`) are properly defined using `defineAtom()` with correct schemas.

### 6. ✅ Builder Pattern (Good)

**Status**: Correctly uses `vm.A99` to get the builder and chains operations properly.

### 7. ✅ AST Compilation (Good)

**Status**: Properly compiles pipelines to JSON AST using `.toJSON()` before execution.

### 8. ✅ Capability-Based Security (Good)

**Status**: Correctly provides capabilities to `vm.run()` and uses custom capabilities for LLM URLs.

### 9. ⚠️ Control Flow Atoms Not Used (Low Priority)

**Issue**: No use of `if`, `while`, `try/catch` atoms which are part of agent-99's control flow features.

**Impact**: Missing opportunity to demonstrate full agent-99 capabilities, but may not be needed for current use case.

### 10. ⚠️ Utility Functions Outside VM (Acceptable)

**Status**: HTML parsing and image extraction functions run outside the VM. This is acceptable for utility functions, but ideally these could be custom atoms if needed inside the VM.

## Recommendations

### High Priority Fixes

1. **Refactor `generateAltText()` to use `httpFetch` atom**:
   - Move URL fetching into the VM
   - Use `httpFetch` atom with capability-based security
   - Pass URL as input arg using `A99.args('url')`

2. **Refactor vision calls to use VM execution**:
   - Replace direct `predictWithVision()` calls with `llmVisionBattery` atom
   - Build complete pipelines within the VM
   - Ensure all logic is compiled to AST

3. **Update `generateCombinedAltText()`**:
   - Use `httpFetch` for page fetching
   - Use `llmVisionBattery` for image processing
   - Keep entire workflow in VM execution model

### Medium Priority Improvements

1. **Verify variable access patterns**:
   - Test if `varSet({ key, value: 'path.to.value' })` is correct
   - Consider using `A99.args()` if needed for dynamic references
   - Update documentation with correct patterns

2. **Add error handling with `try/catch` atoms**:
   - Use agent-99's `try` atom for error handling
   - Demonstrate control flow capabilities

### Low Priority Enhancements

1. **Consider custom atoms for HTML parsing**:
   - If HTML parsing needs to happen in VM, create a custom atom
   - Otherwise, keep as utility functions (acceptable)

2. **Add examples of control flow**:
   - Use `if` atom for conditional logic
   - Use `while` atom for loops if needed

## Code Quality

### Strengths
- ✅ Proper use of builder pattern (`vm.A99`)
- ✅ Correct AST compilation (`.toJSON()`)
- ✅ Good capability-based security implementation
- ✅ Custom atoms properly defined
- ✅ Type-safe schemas using `tosijs-schema`
- ✅ Fuel limits properly set

### Areas for Improvement
- ⚠️ More consistent use of VM execution model
- ⚠️ Better alignment with "agents-as-data" principle
- ⚠️ More idiomatic variable access patterns

## Conclusion

The code demonstrates good understanding of agent-99's core concepts but has some inconsistencies with the design philosophy, particularly around execution models. The main issues are:

1. Using external `fetch()` instead of `httpFetch` atom
2. Direct API calls instead of VM execution
3. Mixed execution models that reduce type safety and portability

Fixing these issues will make the code more idiomatic and better aligned with agent-99's design philosophy.

## Review Status

### ✅ Fixed (2025-12-16)
- **CRITICAL: `generateAltText()` fixed**: Was using `.varGet({ key: 'response.text' })` which got the method reference instead of calling it. Now uses `extractResponseText` atom to properly extract HTML content.
- **Dead code removed**: Removed unused standalone `scoreImageInterestingness()` function - atom version is used
- **Duplicate code removed**: Removed standalone `predictWithVision()` function that duplicated `createCustomCapabilities().llm.predictWithVision`
- **DRY improved**: `testVisionAtom()` now uses `createCustomCapabilities()` instead of duplicating vision capability code
- **Custom atoms created**: `htmlExtractText`, `buildUserPrompt`, `extractResponseText` for VM execution
- **Variable access patterns**: Fixed `varSet` to use string paths correctly
- **Pipeline structure**: Entire workflow now in VM execution model

### ✅ Previously Fixed
- **`generateAltText()` refactored**: Now uses `httpFetch` atom inside VM
- Vision processing uses `llmVisionBattery` atom within VM

### 📝 Notes
- Some utility functions (HTML parsing, image extraction) remain outside VM as helper functions, with atom wrappers for VM use
- All three main functions (`generateAltText()`, `generateImageAltText()`, `generateCombinedAltText()`) now properly follow agent-99's "agents-as-data" principle
- All 16 tests passing

