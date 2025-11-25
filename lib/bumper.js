import * as core from '@actions/core';
import github from '@actions/github';
import OpenAI from 'openai';

// Time constants (moved outside function to avoid recalculation)
const ONE_HOUR_IN_MS = 60 * 60 * 1000;

/**
 * Check if an issue is fixed based on the latest comment using AI analysis.
 * @param {Object|null} latestComment - The latest comment object or null
 * @param {Object|null} openai - OpenAI client or null
 * @returns {Promise<boolean>} - Whether the issue appears to be fixed
 */
export async function isIssueFixed(latestComment, openai) {
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

/**
 * Check if a PR is a Copilot PR.
 * @param {Object} pr - Pull request object
 * @returns {boolean} - Whether the PR is a Copilot PR
 */
export function isCopilotPr(pr) {
  const isCopilotUser = pr.user.login === 'copilot[bot]';
  const titleHasCopilot = pr.title.toLowerCase().includes('copilot');
  const bodyHasCopilot = pr.body?.toLowerCase().includes('copilot') ?? false;
  return isCopilotUser || titleHasCopilot || bodyHasCopilot;
}

/**
 * Check if a PR is work in progress.
 * @param {Object} pr - Pull request object
 * @returns {boolean} - Whether the PR is WIP
 */
export function isWip(pr) {
  return pr.title.toLowerCase().includes('wip') || pr.draft === true;
}

/**
 * Check if a PR is stalled (no activity in the past hour).
 * @param {Object} pr - Pull request object
 * @returns {boolean} - Whether the PR is stalled
 */
export function isStalled(pr) {
  const timeSinceUpdate = new Date() - new Date(pr.updated_at);
  return timeSinceUpdate > ONE_HOUR_IN_MS;
}

/**
 * Get time since last update in milliseconds.
 * @param {Object} pr - Pull request object
 * @returns {number} - Time since last update in milliseconds
 */
export function getTimeSinceUpdate(pr) {
  return new Date() - new Date(pr.updated_at);
}

/**
 * Filter comments to find relevant latest comment (not our bot's bump comment).
 * @param {Array} comments - Array of comment objects
 * @returns {Object|undefined} - The latest relevant comment or undefined
 */
export function findRelevantComment(comments) {
  return comments.find(comment => 
    !comment.body.includes('@copilot still working?')
  );
}

/**
 * Initialize the OpenAI client for GitHub Models.
 * @param {string} token - GitHub token
 * @returns {Object|null} - OpenAI client or null on failure
 */
export function initializeOpenAI(token) {
  try {
    const openai = new OpenAI({ 
      baseURL: 'https://models.github.ai/inference', 
      apiKey: token 
    });
    console.log('✅ GitHub Models client initialized');
    return openai;
  } catch (error) {
    console.log(`⚠️ GitHub Models client initialization failed: ${error.message}. Will fallback to non-AI behavior.`);
    return null;
  }
}

/**
 * Filter notifications to get only PR-related ones, optionally filtering by ownership.
 * @param {Array} notifications - Array of notification objects
 * @param {Object} options - Optional filtering options
 * @param {boolean} options.skipNonOwnedRepos - Whether to filter out non-owned repos
 * @param {string} options.authenticatedUserLogin - The authenticated user's login name
 * @returns {Array} - Filtered PR notifications
 */
export function filterPrNotifications(notifications, options = {}) {
  const { skipNonOwnedRepos = false, authenticatedUserLogin = null } = options;
  
  return notifications.filter(notification => {
    if (notification.subject.type !== 'PullRequest') {
      return false;
    }
    // Early filtering: skip non-owned repos before shuffling to reduce unnecessary processing
    if (skipNonOwnedRepos && authenticatedUserLogin && 
        notification.repository.owner.login !== authenticatedUserLogin) {
      return false;
    }
    return true;
  });
}

/**
 * Shuffle an array randomly.
 * @param {Array} array - Array to shuffle
 * @returns {Array} - Shuffled copy of the array
 */
export function shuffleArray(array) {
  return [...array].sort(() => Math.random() - 0.5);
}

/**
 * Main run function for the Copilot Bumper.
 * @param {Object} options - Configuration options
 * @param {string} options.token - GitHub PAT
 * @param {boolean} options.dryRun - Whether to run in dry mode
 * @param {boolean} options.skipNonOwnedRepos - Whether to skip non-owned repos
 */
export async function run(options = {}) {
  try {
    const token = options.token || process.env.PAT;
    const dryRun = options.dryRun ?? process.env.DRY_RUN === 'true';
    const skipNonOwnedRepos = options.skipNonOwnedRepos ?? process.env.SKIP_NON_OWNED_REPOS !== 'false';

    if (!token) {
      throw new Error('GITHUB_TOKEN not provided. Please set a Personal Access Token with appropriate permissions.');
    }

    // Initialize OpenAI client using GitHub Models API
    const openai = initializeOpenAI(token);

    console.log(`🚀 Starting Copilot PR bumper${dryRun ? ' (DRY RUN MODE)' : ''}${skipNonOwnedRepos ? ' (SKIPPING NON-OWNED REPOS)' : ''}`);
    const octokit = github.getOctokit(token);
    
    // Get the authenticated user to check repository ownership
    const { data: authenticatedUser } = await octokit.rest.users.getAuthenticated();

    // Get notifications related to all repositories
    console.log('Fetching notifications...');
    const notifications = await octokit.rest.activity.listNotificationsForAuthenticatedUser({
      all: true,
      participating: true,
    });

    console.log(`Found ${notifications.data.length} notifications.`);

    // Filter for PR-related notifications, optionally filtering by ownership early to avoid unnecessary work
    const prNotifications = filterPrNotifications(notifications.data, {
      skipNonOwnedRepos,
      authenticatedUserLogin: authenticatedUser.login
    });

    console.log(`Found ${prNotifications.length} PR-related notifications${skipNonOwnedRepos ? ' (filtered to owned repos)' : ''}.`);

    // Shuffle the array of PR notifications for randomized processing
    const shuffledNotifications = shuffleArray(prNotifications);
    console.log(`Randomized processing order of notifications.`);

    // Limit the number of PRs we comment on per run
    const MAX_COMMENTS_PER_RUN = 5;
    let commentsCount = 0;

    async function processNotification(notification) {
      const prUrl = notification.subject.url;
      const prNumber = prUrl.split('/').pop();
      const owner = notification.repository.owner.login;
      const repo = notification.repository.name;
      
      // Note: Ownership filtering is now done earlier during notification filtering
      // for better performance (avoiding unnecessary shuffling and processing)
      
      console.log(`Processing PR #${prNumber} in ${owner}/${repo}...`);
      try {
        // Get PR details
        const { data: pr } = await octokit.rest.pulls.get({
          owner,
          repo,
          pull_number: prNumber
        });
        
        // Check if it's a Copilot PR and if it's stalled
        const isCopilot = isCopilotPr(pr);
        const wipStatus = isWip(pr);
        const stalledStatus = isStalled(pr);
        const timeSinceUpdate = getTimeSinceUpdate(pr);
        
        if (isCopilot && wipStatus && stalledStatus) {
          console.log(`Found stalled Copilot PR: ${owner}/${repo}#${prNumber} - ${pr.title}`);
          console.log(`Last updated: ${pr.updated_at}, time since update: ${Math.round(timeSinceUpdate / 1000 / 60)} minutes`);
          
          // Skip AI analysis if we've already reached the comment limit to avoid wasteful API calls
          if (commentsCount >= MAX_COMMENTS_PER_RUN) {
            console.log(`⏭️ Skipping AI analysis for PR ${owner}/${repo}#${prNumber} - already at max comments limit (${MAX_COMMENTS_PER_RUN})`);
            return;
          }
          
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
              const latestComment = findRelevantComment(comments);
              
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
          // Note: commentsCount is checked again for defensive programming, though in practice
          // it cannot change between the early check and here due to single-threaded execution
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
          } else if (isFixed) {
            console.log(`⏭️ Skipping comment on PR ${owner}/${repo}#${prNumber} - AI determined issue is fixed`);
          }
          // Note: We no longer mark notifications as read
        } else {
          console.log(`PR ${owner}/${repo}#${prNumber} is not a stalled Copilot PR or doesn't need bumping.`);
          console.log(`isCopilotPr: ${isCopilot}, isWip: ${wipStatus}, isStalled: ${stalledStatus}`);
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
