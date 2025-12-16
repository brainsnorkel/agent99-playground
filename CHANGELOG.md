# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased] - Feature: Image Alt-Text Generation

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

