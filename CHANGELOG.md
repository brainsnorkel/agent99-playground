# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased] - Complete Refactoring to Idiomatic Agent-99 Patterns

### Fixed (2025-12-16)
- **httpFetch Response Handling**: Fixed issue where `httpFetch` returns a Response object (not text) when using custom fetch capability. Added `extractResponseText` atom to convert Response.text() to string once (body can only be read once)
- **Argument Reference Resolution**: Fixed atoms not resolving `A99.args()` references correctly. Atoms now resolve from `ctx.args`, `ctx.state`, and `ctx.vars` in order
- **LLM Receiving [object Object]**: Fixed `llmPredictBattery` atom receiving `[object Object]` instead of actual prompt text by resolving argument references before processing
- **Image Pipeline Data Flow**: Fixed image processing pipeline returning wrong data structure. Added `.varSet({ key: 'candidates', value: 'scoredCandidates' })` before `.return()` to pass processed candidates
- **processCandidateImagesAtom**: Fixed using `candidates.map()` instead of `actualCandidates.map()` after resolving argument references

### Changed
- **Full VM Execution**: All functions now execute entirely within agent-99's VM
- **Atom-Based Architecture**: Created custom atoms for all domain operations:
  - `extractResponseText`: Extracts text from HTTP Response objects (handles both Response.text() and direct strings)
  - `extractImagesFromHTMLAtom`: Extracts image information from HTML
  - `filterCandidateImagesAtom`: Filters images larger than icon size
  - `processCandidateImagesAtom`: Fetches and scores images in parallel
  - `scoreImageInterestingnessAtom`: Scores images using LLM vision
  - `fetchImageDataAtom`: Fetches image data with base64 conversion
  - `htmlExtractText`: Extracts text from HTML (already existed)
  - `buildUserPrompt`: Constructs LLM prompts (already existed)
- **Pipeline Refactoring**:
  - `generateImageAltText()`: Now uses complete VM pipeline for all operations
  - `generateCombinedAltText()`: Refactored to use VM pipelines for both page and image processing
  - All HTTP fetching now uses `httpFetch` atom
  - All image processing now uses custom atoms within VM
- **Interestingness Scoring**: Changed from "largest image" to "most interesting image" using LLM vision scoring
  - Filters to images larger than icon size
  - Limits to top 3 candidates
  - Scores all candidates in parallel
  - Selects highest-scoring image

### Added
- **`extractResponseText` Atom**: New atom to handle Response objects from httpFetch
- **Argument Resolution Helper**: Custom atoms now properly resolve `A99.args()` references by checking `ctx.args` first, then `ctx.state`, then `ctx.vars`
- **Debug Logging**: Added logging throughout pipeline to trace data flow
- **Custom Atoms**: 9 custom atoms for domain-specific operations (including new extractResponseText)
- **Parallel Processing**: `processCandidateImagesAtom` handles parallel fetching and scoring
- **Comprehensive Documentation**: 
  - Updated README.md with idiomatic patterns and examples
  - Created AGENT99_PATTERNS.md guide
  - Updated ATOM_PIPELINE_ANALYSIS.md with refactoring details

### Technical Details
- All operations now execute within VM with capability-based security
- All operations tracked in fuel system
- All logic is serializable to JSON AST
- Full type safety with input/output schemas
- Parallel operations encapsulated in atoms
- Error handling with fallbacks within atoms
- Response body is read once via extractResponseText and stored for reuse

### Benefits
- **100% Compliance**: All functions now fully comply with agent-99 principles
- **Security**: All HTTP calls go through `httpFetch` atom
- **Observability**: All operations tracked in fuel system
- **Portability**: Workflows can be serialized and replayed
- **Type Safety**: All operations have schemas
- **Consistency**: All functions follow same execution model

### Testing
- All 16 tests passing
- Updated test error message matching for timeout scenarios
- Tests validate both page and image alt-text generation
- Verified with real URLs (abc.net.au/news) - returns actual content, not hallucinated summaries

## [Previous] - Feature: Combined Page and Image Alt-Text Generation

### Added
- `generateCombinedAltText()` function that generates both page and image alt-text in one operation
- Page context is now used to improve image alt-text generation
- Combined history entries showing both page alt-text and image alt-text with thumbnail
- Single unified processing mode (removed separate page/image modes)

### Changed
- App now always generates both page and image alt-text for each URL
- Image alt-text generation uses page context (topic and alt-text) for better accuracy
- History entries now display:
  - Page topic and alt-text
  - Image thumbnail (if available)
  - Image alt-text (generated with page context)
  - Image description (if available)
- Removed mode selector from UI - all processing is now combined
- Updated `generateImageAltText()` to accept optional page context parameter

### Technical Details
- Page alt-text is generated first using agent-99 batteries
- Page context (alt-text and topic) is passed to image processing
- Image alt-text generation uses page context in the prompt for better relevance
- If image processing fails (no images found), page alt-text is still returned

## [Previous] - Feature: Image Alt-Text Generation

### Added
- `generateImageAltText()` function to find the largest image on a webpage and generate alt-text using LLM vision
- Image extraction from HTML with dimension and size detection
- Vision-capable LLM API support via `predictWithVision()` function
- CLI support for image mode: `bun run src/index.ts --image <url>`
- Image size comparison (by dimensions or file size) to identify largest image
- Base64 image encoding for LLM vision API compatibility
- Web UI support for image mode with mode selector dropdown
- Image thumbnail display in query history entries
- Image metadata display (dimensions, file size, description) in history
- Clickable image thumbnails that open full-size images in new tab
- Mode badges (Page Mode / Image Mode) in history entries
- LocalStorage persistence for processing mode preference
- `llmVisionBattery` custom atom for agent-99 vision processing
- `testVisionAtom()` function to test vision atom with agent-99 execution model
- Comprehensive test suite for vision atom (4 test cases)
- `fetchImageData()` exported function for image fetching and base64 conversion

### Changed
- Updated server API to support both page and image processing modes
- Enhanced `QueryResult` interface to include image-specific fields
- Updated frontend to display image thumbnails and metadata in history

### Technical Details
- Extracts all images from HTML using regex parsing
- Resolves relative image URLs to absolute URLs
- Prioritizes images by area (width × height), falls back to file size
- Uses OpenAI-compatible vision API format for image description
- Supports both dimension-based and file-size-based image selection
- Server handles mode parameter to route to appropriate processing function
- Frontend displays thumbnails with hover effects and error handling

## [1.2.0] - 2025-01-XX

### Added
- Comprehensive test suite with 13 test cases covering:
  - Basic functionality validation
  - Error handling (invalid URLs, 404 errors, malformed URLs)
  - Edge cases for HTML extraction
  - Utility function testing for `extractTextFromHTML`
- Detailed LM Studio setup instructions in README.md with:
  - Step-by-step installation and configuration guide
  - Model recommendations
  - Server verification steps
  - Troubleshooting section
  - Connection testing commands
- Expanded "How It Works" section in README.md documenting key agent-99 pipelines:
  - llmPredictBattery pipeline for LLM interactions
  - Variable management pipelines (as, varGet, varSet)
  - Data transformation pipelines (jsonParse)
  - Output schema pipeline (return)
  - Additional available pipelines (httpFetch, storeVectorize, storeSearch)
  - Pipeline execution model explanation

### Changed
- Fixed test length validation to match requirements (50-150 characters instead of 20-200)
- Exported `extractTextFromHTML` function for testing
- Updated TESTING.md to reflect completed test cases

### Fixed
- Test assertions now correctly validate alt-text length requirements

## [1.1.0] - 2025-01-XX

### Added
- Web app interface with modern UI
- Web server (`src/server.ts`) with REST API endpoints
- HTML frontend (`src/index.html`) with:
  - Collapsible LLM settings panel
  - URL input form
  - Real-time query processing
  - Query history display (newest first)
  - Clear history functionality
- LocalStorage integration for saving LLM settings
- API endpoints:
  - `GET /api/history` - Retrieve query history
  - `POST /api/process` - Process a URL
  - `DELETE /api/history` - Clear query history
- `dev` script in package.json for running the web server

### Changed
- Separated core logic from CLI interface
- Updated README with web app usage instructions

## [1.0.0] - 2025-01-XX

### Fixed
- Fixed import error: `s` schema builder must be imported from `tosijs-schema` directly, not from `agent-99`
- Added `tosijs-schema` as a direct dependency

### Added
- Initial project setup with agent-99 integration
- `generateAltText()` function that scrapes URLs and generates alt-text summaries
- CLI interface for running the summarizer from command line
- Support for agent-99's `httpFetch` atom for web scraping
- Support for agent-99's `llmPredictBattery` atom for LLM-based summarization
- TypeScript configuration and type safety
- README.md with project documentation
- TESTING.md with test instructions and guidelines
- CHANGELOG.md for tracking changes

### Features
- Web scraping using agent-99's httpFetch atom
- LLM-powered alt-text generation suitable for accessibility
- Structured JSON output with alt-text and topic
- Fuel-based execution limits for safety
- Local LLM support via LM Studio integration

### Technical Details
- Uses agent-99's builder API to create type-safe execution chains
- Compiles logic to JSON AST before execution
- Executes in isolated VM with capability-based security
- Supports local development with battery capabilities

[1.0.0]: https://github.com/tonioloewald/agent-99/example-use/releases/tag/v1.0.0

