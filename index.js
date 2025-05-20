import * as core from '@actions/core';
import github from '@actions/github';
import fetch from 'node-fetch';
import 'dotenv/config';
import OpenAI from 'openai';

async function run() {
  try {
    const token = process.env.PAT;
    const dryRun = process.env.DRY_RUN === 'true';
    const skipNonOwnedRepos = process.env.SKIP_NON_OWNED_REPOS !== 'false';

    if (!token) {
      throw new Error('GITHUB_TOKEN not provided. Please set a Personal Access Token with appropriate permissions.');
    }

    // Initialize OpenAI client using GitHub Models API
    let openai = null;
    try {
      openai = new OpenAI({ 
        baseURL: 'https://models.github.ai/inference', 
        apiKey: token 
      });
      console.log('✅ GitHub Models client initialized');
    } catch (error) {
      console.log(`⚠️ GitHub Models client initialization failed: ${error.message}. Will fallback to non-AI behavior.`);
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
    
    // Function to check if an issue is fixed based on the latest comment
    async function isIssueFixed(latestComment, openai) {
      if (!latestComment || !openai) {
        // If no comment or no OpenAI client, assume issue is not fixed
        return false;
      }

      try {
        const prompt = `
The following is a comment on a GitHub PR created by Copilot.
I need to determine if this comment indicates that the issue has been fixed or completed.
Comment: "${latestComment.body}"

Based on this comment, is the issue fixed, resolved, or completed? Answer with "YES" if it appears to be resolved/fixed/completed, or "NO" if it's still in progress or needs more work.`;

        const completion = await openai.chat.completions.create({
          model: "openai/gpt-4.1",
          messages: [
            { role: "system", content: "You are a helpful assistant analyzing GitHub PR comments." },
            { role: "user", content: prompt }
          ],
          temperature: 0.3,
        });

        const response = completion.choices[0].message.content.trim().toUpperCase();
        console.log(`🤖 AI analysis of latest comment: ${response}`);
        return response.includes('YES');
      } catch (error) {
        console.error('Error using OpenAI to analyze comment:', error.message);
        return false; // Default to not fixed if there's an error
      }
    }

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
          
          // Get the latest comment to analyze if the issue is fixed
          let isFixed = false;
          if (openai) {
            try {
              // Get the latest comment on the PR
              const { data: comments } = await octokit.rest.issues.listComments({
                owner,
                repo,
                issue_number: prNumber,
                per_page: 5, // Get the most recent comments
                sort: 'created',
                direction: 'desc'
              });
              
              // Get the latest comment that is not from our bot
              const latestComment = comments.find(comment => 
                !comment.body.includes('@copilot still working?')
              );
              
              if (latestComment) {
                console.log(`Found latest comment from ${latestComment.user.login}: "${latestComment.body.substring(0, 100)}${latestComment.body.length > 100 ? '...' : ''}"`);
                isFixed = await isIssueFixed(latestComment, openai);
                console.log(`Issue appears to be ${isFixed ? 'fixed' : 'not fixed'} based on AI analysis`);
              } else {
                console.log(`No relevant comments found to analyze`);
              }
            } catch (commentsError) {
              console.error(`Error fetching comments for PR ${owner}/${repo}#${prNumber}:`, commentsError.message);
            }
          }
          
          // Add comment to ask Copilot to try again (unless in DRY_RUN mode or issue is fixed)
          // But only if we haven't reached the maximum number of comments per run
          if (!isFixed && commentsCount < MAX_COMMENTS_PER_RUN) {
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
