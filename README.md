# CrowBrain

Local context storage and retrieval vault for AI agents.

CrowBrain provides a local-first markdown vault and knowledge graph tailored for AI coding harnesses and agents (such as Antigravity, Claude Code, and Codex) via the Model Context Protocol (MCP).

## Overview
AI agents routinely lose context across separate sessions. CrowBrain provides a persistent, structured storage layer where agents can save learnings, recall project decisions, and traverse relational knowledge graphs while keeping notes human-readable and compatible with Obsidian.

## Core Capabilities
- Model Context Protocol (MCP) server for local tool integration.
- Bidirectional link graph and tag indexing.
- Local-first markdown storage with YAML frontmatter.
- Electron-based desktop application with live agent activity inspection.
- Light, dark, and user-defined themes.
- Configurable ease-in-out interface animations.
- GitHub Releases update checking without external server dependencies.

## Architecture
- Runtime: Electron, Node.js, TypeScript
- Frontend: React, Tailwind CSS
- Storage: Local filesystem Markdown with SQLite index
- Interface: Model Context Protocol (MCP)

## License
MIT
