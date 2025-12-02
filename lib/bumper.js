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
 * @param {number} thresholdMs - Optional stall threshold in milliseconds (default: 1 hour)
 * @returns {boolean} - Whether the PR is stalled
 */
export function isStalled(pr, thresholdMs = ONE_HOUR_IN_MS) {
  const timeSinceUpdate = new Date() - new Date(pr.updated_at);
  return timeSinceUpdate > thresholdMs;
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
    !comment.body.includes('@copilot still working?') &&
    !comment.body.includes('@copilot please implement the feedback') &&
    !comment.body.includes('@copilot There is a merge conflict') &&
    !comment.body.includes('@copilot The CI checks are failing')
  );
}

/**
 * Check if there are unaddressed review comments on a PR.
 * Review comments are line-level feedback that haven't been resolved.
 * @param {Array} reviewComments - Array of review comment objects
 * @returns {boolean} - Whether there are unaddressed review comments
 */
export function hasReviewComments(reviewComments) {
  if (!reviewComments || !Array.isArray(reviewComments)) {
    return false;
  }
  return reviewComments.length > 0;
}

/**
 * Find the latest review comment that is not from Copilot.
 * @param {Array} reviewComments - Array of review comment objects sorted by created_at desc
 * @returns {Object|undefined} - The latest review comment from a human or undefined
 */
export function findLatestReviewComment(reviewComments) {
  if (!reviewComments || !Array.isArray(reviewComments)) {
    return undefined;
  }
  // Find the first review comment that has a valid user and is not from copilot[bot]
  return reviewComments.find(comment => 
    comment.user && comment.user.login && comment.user.login !== 'copilot[bot]'
  );
}

/**
 * Check if a PR has merge conflicts with the base branch.
 * @param {Object} pr - Pull request object
 * @returns {boolean} - Whether the PR has merge conflicts
 */
export function hasMergeConflict(pr) {
  // GitHub API returns mergeable=false and mergeable_state='dirty' for conflicts
  // Note: mergeable can be null if GitHub hasn't computed it yet
  return pr.mergeable === false && pr.mergeable_state === 'dirty';
}

/**
 * Check if a comment from Copilot indicates an error/failure.
 * @param {Object|null} comment - The comment object or null
 * @returns {boolean} - Whether the comment indicates Copilot encountered an error
 */
export function isCopilotError(comment) {
  if (!comment || !comment.body) {
    return false;
  }
  
  // Only check comments from copilot[bot]
  if (comment.user?.login !== 'copilot[bot]') {
    return false;
  }
  
  const body = comment.body.toLowerCase();
  
  // Common error indicators from Copilot
  const errorPatterns = [
    'i encountered an error',
    'i ran into an error',
    'an error occurred',
    'i\'m having trouble',
    'i was unable to',
    'i couldn\'t',
    'failed to',
    'something went wrong',
    'i apologize',
    'unfortunately',
    'i\'m sorry',
  ];
  
  return errorPatterns.some(pattern => body.includes(pattern));
}

/**
 * Check if the PR timeline has a copilot_session_stopped event indicating Copilot session stopped.
 * Check if the PR timeline has a copilot_session_stopped event indicating Copilot session failed.
 * @param {Array} timelineEvents - Array of timeline event objects
 * @returns {boolean} - Whether the timeline contains a Copilot session stopped event
 */
export function hasCopilotSessionStopped(timelineEvents) {
  if (!timelineEvents || !Array.isArray(timelineEvents)) {
    return false;
  }
  
  return timelineEvents.some(event => event.event === 'copilot_session_stopped');
}

/**
 * Check if a Copilot session failed based on PR timeline events.
 * Looks for copilot_session_stopped events with failure outcome.
 * @param {Array} timelineEvents - Array of timeline event objects
 * @returns {boolean} - Whether a Copilot session failed
 */
export function hasFailedCopilotSession(timelineEvents) {
  if (!timelineEvents || !Array.isArray(timelineEvents)) {
    return false;
  }
  
  // Look for copilot_session_stopped events with failure outcome
  return timelineEvents.some(event => 
    event.event === 'copilot_session_stopped' && 
    event.copilot_session?.outcome === 'failure'
  );
}

/**
 * Check if a PR has failing check runs that need attention.
 * @param {Array} checkRuns - Array of check run objects
 * @returns {boolean} - Whether there are failing check runs
 */
export function hasFailingCheckRuns(checkRuns) {
  if (!checkRuns || !Array.isArray(checkRuns)) {
    return false;
  }
  
  // Check if any check runs have failed or have action required
  return checkRuns.some(run => 
    run.conclusion === 'failure' || 
    run.conclusion === 'action_required' ||
    run.conclusion === 'timed_out'
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
  
 * Filter notifications to get only PR-related ones.
 * @param {Array} notifications - Array of notification objects
 * @returns {Array} - Filtered PR notifications
 */
export function filterPrNotifications(notifications) {
  return notifications.filter(notification => 
    notification.subject.type === 'PullRequest'
  );
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
    // Minimum bumps before considering a second pass with relaxed criteria
    const MIN_BUMPS_FOR_SECOND_PASS = 2;
    // Standard stall threshold (1 hour)
    const STALL_THRESHOLD_MS = ONE_HOUR_IN_MS;
    // Relaxed stall threshold for second pass (30 minutes)
    const RELAXED_STALL_THRESHOLD_MS = 30 * 60 * 1000;
    // Number of recent comments to fetch for analysis
    const RECENT_COMMENTS_TO_FETCH = 5;
    let commentsCount = 0;
    // Track which PRs we've already processed or bumped
    const processedPrKeys = new Set();

    async function processNotification(notification, stallThresholdMs = STALL_THRESHOLD_MS) {
      const prUrl = notification.subject.url;
      const prNumber = prUrl.split('/').pop();
      const owner = notification.repository.owner.login;
      const repo = notification.repository.name;
      const prKey = `${owner}/${repo}#${prNumber}`;
      
      // Skip if we've already processed this PR (in first pass)
      if (processedPrKeys.has(prKey)) {
        return false;
      }
      
      // Note: Ownership filtering is now done earlier during notification filtering
      // for better performance (avoiding unnecessary shuffling and processing)
      // Skip repositories not owned by the authenticated user if skipNonOwnedRepos is true
      if (skipNonOwnedRepos && owner !== authenticatedUser.login) {
        console.log(`Skipping PR #${prNumber} in ${owner}/${repo} - not owned by you`);
        processedPrKeys.add(prKey);
        return false;
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
        const isCopilot = isCopilotPr(pr);
        const wipStatus = isWip(pr);
        const stalledStatus = isStalled(pr, stallThresholdMs);
        const timeSinceUpdate = getTimeSinceUpdate(pr);
        
        // For stalled Copilot PRs, check if they need bumping
        // We need WIP unless Copilot session stopped or encountered an error
        if (isCopilot && stalledStatus) {
          // Fetch timeline events to check for copilot_session_stopped
          // We fetch the most recent 100 events which should be sufficient since
          // copilot_session_stopped events are typically recent (session just stopped)
          let timelineEvents = [];
          try {
            const { data: fetchedTimelineEvents } = await octokit.rest.issues.listEventsForTimeline({
              owner,
              repo,
              issue_number: prNumber,
              per_page: 100
            });
            timelineEvents = fetchedTimelineEvents;
          } catch (timelineError) {
            console.error(`Error fetching timeline for PR ${owner}/${repo}#${prNumber}:`, timelineError.message);
          }
          
          // Check if Copilot session stopped via timeline events
          const sessionStopped = hasCopilotSessionStopped(timelineEvents);
          
          // Get comments to check for errors and if issue is fixed
          let comments = [];
          try {
            const { data: fetchedComments } = await octokit.rest.issues.listComments({
              owner,
              repo,
              issue_number: prNumber,
              per_page: RECENT_COMMENTS_TO_FETCH,
              sort: 'created',
              direction: 'desc'
            });
            comments = fetchedComments;
          } catch (commentsError) {
            console.error(`Error fetching comments for PR ${owner}/${repo}#${prNumber}:`, commentsError.message);
          }
          
          // Check if Copilot encountered an error via comment text (fallback)
          const latestCopilotComment = comments.find(c => c.user?.login === 'copilot[bot]');
          const hasError = isCopilotError(latestCopilotComment);
          
          // Require WIP unless Copilot session stopped or had an error
          if (!wipStatus && !sessionStopped && !hasError) {
            console.log(`PR ${owner}/${repo}#${prNumber} requires WIP status, session stopped, or Copilot error to be bumped.`);
            console.log(`isCopilotPr: ${isCopilot}, isWip: ${wipStatus}, isStalled: ${stalledStatus}, sessionStopped: ${sessionStopped}, hasError: ${hasError}`);
            processedPrKeys.add(prKey);
            return false;
          }
          
          // Check if Copilot session failed with explicit failure outcome
          const hasSessionFailure = hasFailedCopilotSession(timelineEvents);
          if (hasSessionFailure) {
            console.log(`🔴 Copilot session failed based on timeline events`);
          }
          
          // Check for failing check runs
          let hasFailingChecks = false;
          try {
            const { data: checkRunsData } = await octokit.rest.checks.listForRef({
              owner,
              repo,
              ref: pr.head.sha
            });
            hasFailingChecks = hasFailingCheckRuns(checkRunsData.check_runs);
            if (hasFailingChecks) {
              console.log(`❌ PR has failing check runs`);
            }
          } catch (checksError) {
            console.error(`Error fetching check runs for PR ${owner}/${repo}#${prNumber}:`, checksError.message);
          }
          
          // Require WIP unless Copilot session stopped, had an error, session failed, or checks are failing
          if (!wipStatus && !sessionStopped && !hasError && !hasSessionFailure && !hasFailingChecks) {
            console.log(`PR ${owner}/${repo}#${prNumber} requires WIP status, session stopped, Copilot error, session failure, or failing checks to be bumped.`);
            console.log(`isCopilotPr: ${isCopilot}, isWip: ${wipStatus}, isStalled: ${stalledStatus}, sessionStopped: ${sessionStopped}, hasError: ${hasError}, hasSessionFailure: ${hasSessionFailure}, hasFailingChecks: ${hasFailingChecks}`);
            return;
          }
          
          console.log(`Found stalled Copilot PR: ${owner}/${repo}#${prNumber} - ${pr.title}`);
          console.log(`Last updated: ${pr.updated_at}, time since update: ${Math.round(timeSinceUpdate / 1000 / 60)} minutes`);
          if (sessionStopped) {
            console.log(`🛑 Copilot session stopped - WIP not required`);
          }
          if (hasError) {
            console.log(`⚠️ Copilot encountered an error - WIP not required`);
          }
          
          // Skip AI analysis if we've already reached the comment limit to avoid wasteful API calls
          if (commentsCount >= MAX_COMMENTS_PER_RUN) {
            console.log(`⏭️ Skipping AI analysis for PR ${owner}/${repo}#${prNumber} - already at max comments limit (${MAX_COMMENTS_PER_RUN})`);
            processedPrKeys.add(prKey);
            return false;
          }
          
          if (hasSessionFailure) {
            console.log(`🔴 Copilot session failed - WIP not required`);
          }
          if (hasFailingChecks) {
            console.log(`❌ PR has failing checks - WIP not required`);
          }
          
          // Get the latest comment to analyze if the issue is fixed
          let isFixed = false;
          if (openai) {
            // Get the latest comment that is not from our bot
            const latestComment = findRelevantComment(comments);
            
            if (latestComment) {
              console.log(`Found latest comment from ${latestComment.user.login}: "${latestComment.body.substring(0, 100)}${latestComment.body.length > 100 ? '...' : ''}"`);
              isFixed = await isIssueFixed(latestComment, openai);
              console.log(`Issue appears to be ${isFixed ? 'fixed' : 'not fixed'} based on AI analysis`);
            } else {
              console.log(`No relevant comments found to analyze`);
            }
          }
          
          // Fetch review comments (line-level feedback) to check if there's feedback to implement
          let reviewComments = [];
          try {
            const { data: fetchedReviewComments } = await octokit.rest.pulls.listReviewComments({
              owner,
              repo,
              pull_number: prNumber,
              per_page: RECENT_COMMENTS_TO_FETCH,
              sort: 'created',
              direction: 'desc'
            });
            reviewComments = fetchedReviewComments;
          } catch (reviewCommentsError) {
            console.error(`Error fetching review comments for PR ${owner}/${repo}#${prNumber}:`, reviewCommentsError.message);
          }
          
          // Check if there are review comments (line-level feedback)
          const hasFeedback = hasReviewComments(reviewComments);
          const latestFeedback = findLatestReviewComment(reviewComments);
          
          if (hasFeedback && latestFeedback) {
            console.log(`📝 Found line-level feedback from ${latestFeedback.user.login}: "${latestFeedback.body.substring(0, 100)}${latestFeedback.body.length > 100 ? '...' : ''}"`);
          }
          
          // Check for merge conflicts
          const mergeConflict = hasMergeConflict(pr);
          if (mergeConflict) {
            console.log(`⚠️ PR has merge conflicts with base branch`);
          }
          
          // Add comment to ask Copilot to try again (unless in DRY_RUN mode or issue is fixed)
          // But only if we haven't reached the maximum number of comments per run
          if (!isFixed && commentsCount < MAX_COMMENTS_PER_RUN) {
            // Determine comment based on priority: merge conflicts > failing checks > line-level feedback > still working
            let commentBody;
            if (mergeConflict) {
              commentBody = '@copilot There is a merge conflict with the base branch. Please merge in the base branch and resolve the conflicts.';
            } else if (hasFailingChecks) {
              commentBody = '@copilot The CI checks are failing. Please fix the failing tests or build issues.';
            } else if (hasFeedback) {
              commentBody = '@copilot please implement the feedback left on this PR.';
            } else {
              commentBody = '@copilot still working?';
            }
            
            if (!dryRun) {
              await octokit.rest.issues.createComment({
                owner,
                repo,
                issue_number: prNumber,
                body: commentBody
              });
              if (mergeConflict) {
                console.log(`🔀 Asked Copilot to resolve merge conflicts on PR ${owner}/${repo}#${prNumber}`);
              } else if (hasFailingChecks) {
                console.log(`❌ Asked Copilot to fix failing checks on PR ${owner}/${repo}#${prNumber}`);
              } else if (hasFeedback) {
                console.log(`💬 Asked Copilot to implement feedback on PR ${owner}/${repo}#${prNumber}`);
              } else {
                console.log(`🔄 Asked Copilot to try again on PR ${owner}/${repo}#${prNumber}`);
              }
              commentsCount++;
              processedPrKeys.add(prKey);
              return true;
            } else {
              if (mergeConflict) {
                console.log(`🔀 [DRY RUN] Would have asked Copilot to resolve merge conflicts on PR ${owner}/${repo}#${prNumber}`);
              } else if (hasFailingChecks) {
                console.log(`❌ [DRY RUN] Would have asked Copilot to fix failing checks on PR ${owner}/${repo}#${prNumber}`);
              } else if (hasFeedback) {
                console.log(`💬 [DRY RUN] Would have asked Copilot to implement feedback on PR ${owner}/${repo}#${prNumber}`);
              } else {
                console.log(`🔄 [DRY RUN] Would have asked Copilot to try again on PR ${owner}/${repo}#${prNumber}`);
              }
              commentsCount++;
              processedPrKeys.add(prKey);
              return true;
            }
          } else if (isFixed) {
            console.log(`⏭️ Skipping comment on PR ${owner}/${repo}#${prNumber} - AI determined issue is fixed`);
            processedPrKeys.add(prKey);
            return false;
          } else {
            console.log(`⏭️ Skipping comment on PR ${owner}/${repo}#${prNumber} - reached max comments limit (${MAX_COMMENTS_PER_RUN})`);
            processedPrKeys.add(prKey);
            return false;
          }
          // Note: We no longer mark notifications as read
        } else {
          console.log(`PR ${owner}/${repo}#${prNumber} is not a stalled Copilot PR or doesn't need bumping.`);
          console.log(`isCopilotPr: ${isCopilot}, isWip: ${wipStatus}, isStalled: ${stalledStatus}`);
          // Don't mark as processed if it's a Copilot PR that's not stalled yet - 
          // it might become stalled with relaxed threshold in second pass
          if (!isCopilot) {
            // If it's not a Copilot PR, it won't ever be bumped
            processedPrKeys.add(prKey);
          }
          return false;
        }
      } catch (prError) {
        console.error(`Error processing PR ${owner}/${repo}#${prNumber}:`, prError.message);
        // Continue with other notifications even if one fails
        processedPrKeys.add(prKey);
        return false;
      }
    }

    // First pass: Process notifications with standard stall threshold (1 hour)
    console.log('📋 First pass: Processing with standard stall threshold (1 hour)...');
    for (const notification of shuffledNotifications) {
      await processNotification(notification, STALL_THRESHOLD_MS);
      
      // Stop processing if we've reached the maximum comments limit
      if (commentsCount >= MAX_COMMENTS_PER_RUN) {
        console.log(`🛑 Reached maximum comment limit (${MAX_COMMENTS_PER_RUN}). Stopping.`);
        break;
      }
    }

    // Second pass: If we bumped fewer than the minimum threshold, try again with relaxed criteria
    if (commentsCount < MIN_BUMPS_FOR_SECOND_PASS && commentsCount < MAX_COMMENTS_PER_RUN) {
      console.log(`📋 Second pass: Only bumped ${commentsCount} PRs, trying with relaxed stall threshold (30 minutes)...`);
      
      for (const notification of shuffledNotifications) {
        await processNotification(notification, RELAXED_STALL_THRESHOLD_MS);
        
        // Stop processing if we've reached the maximum comments limit
        if (commentsCount >= MAX_COMMENTS_PER_RUN) {
          console.log(`🛑 Reached maximum comment limit (${MAX_COMMENTS_PER_RUN}). Stopping.`);
          break;
        }
      }
    }

    console.log(`📊 Total PRs bumped: ${commentsCount}`);
    console.log('✅ Copilot PR bumping process completed.');
  } catch (error) {
    core.setFailed(`Action failed with error: ${error.message}`);
    console.error('Error details:', error);
  }
}
