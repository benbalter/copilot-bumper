# Copilot Bumper

A GitHub Action to automatically detect and bump stalled Work-In-Progress (WIP) Pull Requests created by GitHub Copilot across all your repositories.

## Problem

When using GitHub Copilot to automatically create PRs for issues, you might hit rate limits when assigning multiple issues. This can result in stalled Copilot PRs that need manual intervention to continue.

## Solution

This action:
1. Scans your GitHub notifications across all repositories
2. Identifies stalled Copilot-created PRs that are marked as WIP
3. Automatically adds a comment asking Copilot to try again

## Setup Instructions

### 1. Create a Personal Access Token (PAT)

Create a GitHub Personal Access Token with the following permissions:
- `repo` (Full control of private repositories)
- `notifications` (Access to notifications)

### 2. Add PAT to Repository Secrets

Add your PAT as a repository secret named `COPILOT_PAT`.

### 3. Configure the Action

The action is already configured to run every 3 hours, but you can adjust the frequency in the `.github/workflows/copilot-bumper.yml` file.

## Usage

The action will run automatically according to the schedule, or you can trigger it manually from the "Actions" tab in your repository.

### Dry Run Mode

You can run the action in "dry run" mode, which will identify stalled PRs but not actually comment on them. This is useful for testing.

To use dry run mode:
1. Go to the "Actions" tab in your repository
2. Select the "Copilot PR Bumper" workflow
3. Click "Run workflow"
4. Select "true" from the "Dry run mode" dropdown
5. Click "Run workflow"

You can also enable dry run mode when running locally by setting the `DRY_RUN=true` environment variable.

### Repository Access Control

By default, the action will only process repositories that you own. This prevents you from bumping PRs in repositories where you might not have permission to comment or where it might not be appropriate.

To change this behavior:
1. Go to the "Actions" tab in your repository
2. Select the "Copilot PR Bumper" workflow
3. Click "Run workflow"
4. Select "false" from the "Skip repositories not owned by you" dropdown
5. Click "Run workflow"

You can also configure this when running locally by setting the `SKIP_NON_OWNED_REPOS=false` environment variable.

## How it Works

1. The action fetches all your GitHub notifications
2. It filters for pull request notifications across all your repositories
3. It randomly shuffles the order of notifications to ensure different PRs get attention over time
4. For each notification, it checks if the PR:
   - Was created by Copilot (based on user or content)
   - Is marked as a draft or contains "WIP" in the title
   - Hasn't been updated in the last hour OR the last 24 hours
5. If all conditions are met, it adds a comment with `@copilot still working?` to trigger Copilot to continue working
6. Limits commenting to a maximum of 5 PRs per run to avoid hitting GitHub API rate limits

## Customization

You can modify `index.js` to adjust:
- The stall detection period (currently: 1 hour or 24 hours)
- The comment used to trigger Copilot
- The PR identification criteria

## License

MIT