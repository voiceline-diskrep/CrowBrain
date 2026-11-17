# Project Rules and Guidelines

## 1. Tone and Communication
- Do not use emojis anywhere in the project, including:
  - Commit messages
  - Pull request descriptions
  - Release notes and changelogs
  - In-app text, dialogs, and notifications
  - Documentation and comments
- Use professional, clear, and direct language.
- Prohibit marketing buzzwords, hyperbolic claims, and filler phrases.
  - Avoid: "Supercharge your agent workflow with lightning-fast recall!"
  - Preferred: "Local context storage and retrieval vault for AI agents."

## 2. Versioning Standard
Version format adheres to Semantic Versioning (`MAJOR.MINOR.PATCH`):
- `PATCH` (e.g., `0.0.1` -> `0.0.2`): Small bug fixes, minor performance improvements, and small corrections.
- `MINOR` (e.g., `0.1.0` -> `0.2.0`): New features, new MCP endpoints or tools, new UI capabilities, and configuration options.
- `MAJOR` (e.g., `0.x.x` -> `1.0.0`): Breaking changes or significant milestones. This digit changes only upon explicit user instruction.

## 3. Releases and Updates
- Changes are published as GitHub releases against tagged versions.
- The desktop client includes a GitHub Releases updater that polls `https://api.github.com/repos/voiceline-diskrep/CrowBrain/releases/latest`.
- The application must operate without a custom update server.
- Release notes must list changes cleanly without emoji or promotional phrasing.

## 4. User Interface, Animation, and Themes
- All state transitions, drawer movements, and modal presentations must use smooth ease-in-out animations.
- Animation speed and toggles must be controllable via application settings (Normal, Reduced, Disabled).
- Support multiple built-in themes:
  - Light (high contrast, paper-like)
  - Dark (neutral slate and graphite)
  - Custom theme support via tokenized CSS variables and JSON configuration.

## 5. Model Context Protocol (MCP) Standard
- Expose standardized tools for agent harnesses:
  - Memory search
  - Note reading and writing
  - Graph relationship queries
- Preserve human-readable Markdown format with YAML frontmatter across all vault files.
