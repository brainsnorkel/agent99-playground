# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

