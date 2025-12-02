# Copilot Instructions for copilot-bumper

## Project Overview

This is a GitHub Action that automatically detects and bumps stalled Work-In-Progress (WIP) Pull Requests created by GitHub Copilot. It scans notifications, identifies stalled Copilot PRs, and comments to trigger Copilot to continue working.

## Tech Stack

- **Runtime**: Node.js 20+ with ES modules (`"type": "module"`)
- **Testing**: Jest with experimental VM modules flag
- **Dependencies**: 
  - `@actions/core` and `@actions/github` for GitHub Actions integration
  - `openai` for GitHub Models AI analysis
  - `dotenv` for local environment configuration

## Repository Structure

- `index.js` - Entry point that initializes and runs the bumper
- `lib/bumper.js` - Core logic with exported utility functions
- `__tests__/bumper.test.js` - Unit tests using Jest
- `.github/workflows/` - CI and workflow configurations

## Coding Conventions

- Use ES module syntax (`import`/`export`)
- Use `async/await` for asynchronous operations
- Follow existing code style with descriptive function names
- Add JSDoc comments for exported functions
- Console logging with emoji prefixes for status messages (✅, ⚠️, 🔄, 🛑, 🤖, 🚀)

## Testing

- Run tests with: `npm test`
- Tests use Jest with `--experimental-vm-modules` flag
- Mock external dependencies (OpenAI, GitHub API) in tests
- Test files should be in `__tests__/` directory with `.test.js` suffix

## Building and Running

- Install dependencies: `npm install` or `npm ci`
- Run locally: `npm start` (requires `.env` file with PAT token)
- No build step required - runs directly as Node.js

## Key Functions in lib/bumper.js

- `run()` - Main entry point for the action
- `isCopilotPr()` - Check if PR was created by Copilot
- `isWip()` - Check if PR is work-in-progress
- `isStalled()` - Check if PR has no activity in past hour
- `isIssueFixed()` - Use AI to analyze if issue is resolved
- `findRelevantComment()` - Filter comments to find latest relevant one

## Environment Variables

- `PAT` - GitHub Personal Access Token (required)
- `DRY_RUN` - Set to "true" to run without commenting
- `SKIP_NON_OWNED_REPOS` - Set to "false" to process all repos

## Important Notes

- This action uses GitHub Models API for AI analysis via the OpenAI SDK
- The action limits comments to 5 PRs per run to avoid rate limits
- PR notifications are shuffled to ensure different PRs get attention over time
