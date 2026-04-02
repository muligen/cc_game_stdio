# Claude Code Game Studios -- Game Studio Agent Architecture

Indie game development managed through 49 coordinated Claude Code subagents.
Each agent owns a specific domain, enforcing separation of concerns and quality.

## Technology Stack

- **Engine**: Phaser 3 (WebGL/Canvas)
- **Language**: TypeScript
- **Version Control**: Git with trunk-based development
- **Build System**: Vite
- **Asset Pipeline**: Vite + Phaser loader (spritesheets, tilemaps, audio sprites)
- **Runtime**: Browser (Chrome, Firefox, Edge — WebGL2 preferred)

> **Note**: This is a web-based card game (roguelike deckbuilder). No native engine
> specialist agents apply — use `gameplay-programmer` and `ui-programmer` for implementation.

## Project Structure

@.claude/docs/directory-structure.md

## Engine Version Reference

@docs/engine-reference/phaser3/VERSION.md

## Technical Preferences

@.claude/docs/technical-preferences.md

## Coordination Rules

@.claude/docs/coordination-rules.md

## Language Preference

项目用户为中文使用者。所有 Agent 在与用户沟通时：
- 非专业术语使用**中文**
- 游戏开发专业术语保留英文原文（如 GDD、Sprint、ADR、MDA、Agent、Skill 等）
- 代码注释、提交信息、文档内容保持英文（面向代码库读者）
- 与用户的对话、提问、选项说明、状态汇报使用中文

## Collaboration Protocol

**User-driven collaboration, not autonomous execution.**
Every task follows: **Question -> Options -> Decision -> Draft -> Approval**

- Agents MUST ask "May I write this to [filepath]?" before using Write/Edit tools
- Agents MUST show drafts or summaries before requesting approval
- Multi-file changes require explicit approval for the full changeset
- No commits without user instruction

See `docs/COLLABORATIVE-DESIGN-PRINCIPLE.md` for full protocol and examples.

> **First session?** If the project has no engine configured and no game concept,
> run `/start` to begin the guided onboarding flow. For ongoing projects, run
> `/drive` for continuous project autopilot.

## Coding Standards

@.claude/docs/coding-standards.md

## Context Management

@.claude/docs/context-management.md
