import * as core from '@actions/core';
import github from '@actions/github';
import fetch from 'node-fetch';
import 'dotenv/config';

async function run() {
  try {
    const token = process.env.PAT;
    const dryRun = process.env.DRY_RUN === 'true';
    const skipNonOwnedRepos = process.env.SKIP_NON_OWNED_REPOS !== 'false';

    if (!token) {
      throw new Error('GITHUB_TOKEN not provided. Please set a Personal Access Token with appropriate permissions.');
    }

    console.log(`🚀 Starting Copilot PR bumper${dryRun ? ' (DRY RUN MODE)' : ''}${skipNonOwnedRepos ? ' (SKIPPING NON-OWNED REPOS)' : ''}`);
    const octokit = github.getOctokit(token)
    
    // Get the authenticated user to check repository ownership
    const { data: authenticatedUser } = await octokit.rest.users.getAuthenticated();

    // Get notifications related to all repositories
    console.log('Fetching notifications...');
    const notifications = await octokit.rest.activity.listNotificationsForAuthenticatedUser({
      all: true,
      participating: true,
    });

    console.log(`Found ${notifications.data.length} notifications.`);

    // Filter for PR-related notifications, now from any repo
    const prNotifications = notifications.data.filter(notification => 
      notification.subject.type === 'PullRequest'
    );

    console.log(`Found ${prNotifications.length} PR-related notifications.`);

    // Shuffle the array of PR notifications for randomized processing
    const shuffledNotifications = [...prNotifications].sort(() => Math.random() - 0.5);
    console.log(`Randomized processing order of notifications.`);

    // Limit the number of PRs we comment on per run
    const MAX_COMMENTS_PER_RUN = 5;
    let commentsCount = 0;
    
    async function processNotification(notification) {
      const prUrl = notification.subject.url;
      const prNumber = prUrl.split('/').pop();
      const owner = notification.repository.owner.login;
      const repo = notification.repository.name;
      
      // Skip repositories not owned by the authenticated user if skipNonOwnedRepos is true
      if (skipNonOwnedRepos && owner !== authenticatedUser.login) {
        console.log(`Skipping PR #${prNumber} in ${owner}/${repo} - not owned by you`);
        return;
      }
      
      console.log(`Processing PR #${prNumber} in ${owner}/${repo}...`);
      try {
        // Get PR details
        const { data: pr } = await octokit.rest.pulls.get({
          owner,
          repo,
          pull_number: prNumber
        });
        // Check if it's a Copilot PR and if it's stalled
        const isCopilotPr = pr.user.login === 'copilot[bot]' || 
                            pr.title.toLowerCase().includes('copilot') || 
                            pr.body?.toLowerCase().includes('copilot');
        const isWip = pr.title.toLowerCase().includes('wip') || pr.draft === true;
        // Update stalled check to include PRs with no activity in the past hour
        const oneHourInMs = 60 * 60 * 1000;
        const oneDayInMs = 24 * 60 * 60 * 1000;
        const timeSinceUpdate = new Date() - new Date(pr.updated_at);
        const noActivityPastHour = timeSinceUpdate > oneHourInMs;
        const noActivityPastDay = timeSinceUpdate > oneDayInMs;
        const isStalled = isWip && (noActivityPastHour || noActivityPastDay);
        if (isCopilotPr && isStalled) {
          console.log(`Found stalled Copilot PR: ${owner}/${repo}#${prNumber} - ${pr.title}`);
          console.log(`Last updated: ${pr.updated_at}, time since update: ${Math.round(timeSinceUpdate / 1000 / 60)} minutes`);
          
          // Add comment to ask Copilot to try again (unless in DRY_RUN mode)
          // But only if we haven't reached the maximum number of comments per run
          if (commentsCount < MAX_COMMENTS_PER_RUN) {
            if (!dryRun) {
              await octokit.rest.issues.createComment({
                owner,
                repo,
                issue_number: prNumber,
                body: '@copilot still working?'
              });
              console.log(`🔄 Asked Copilot to try again on PR ${owner}/${repo}#${prNumber}`);
              commentsCount++;
            } else {
              console.log(`🔄 [DRY RUN] Would have asked Copilot to try again on PR ${owner}/${repo}#${prNumber}`);
              commentsCount++;
            }
          } else {
            console.log(`⏭️ Skipping comment on PR ${owner}/${repo}#${prNumber} - reached max comments limit (${MAX_COMMENTS_PER_RUN})`);
          }
          // Note: We no longer mark notifications as read
        } else {
          console.log(`PR ${owner}/${repo}#${prNumber} is not a stalled Copilot PR or doesn't need bumping.`);
          console.log(`isCopilotPr: ${isCopilotPr}, isWip: ${isWip}, isStalled: ${isStalled}`);
        }
      } catch (prError) {
        console.error(`Error processing PR ${owner}/${repo}#${prNumber}:`, prError.message);
        // Continue with other notifications even if one fails
      }
    }

    // Process shuffled notifications sequentially
    for (const notification of shuffledNotifications) {
      await processNotification(notification);
      
      // Stop processing if we've reached the maximum comments limit
      if (commentsCount >= MAX_COMMENTS_PER_RUN) {
        console.log(`🛑 Reached maximum comment limit (${MAX_COMMENTS_PER_RUN}). Stopping.`);
        break;
      }
    }

    console.log('✅ Copilot PR bumping process completed.');
  } catch (error) {
    core.setFailed(`Action failed with error: ${error.message}`);
    console.error('Error details:', error);
  }
}

run();
