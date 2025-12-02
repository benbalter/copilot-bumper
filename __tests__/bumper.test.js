import { jest } from '@jest/globals';
import {
  isCopilotPr,
  isWip,
  isStalled,
  getTimeSinceUpdate,
  findRelevantComment,
  filterPrNotifications,
  shuffleArray,
  isIssueFixed,
  isCopilotError,
  hasReviewComments,
  findLatestReviewComment,
  hasMergeConflict,
  hasCopilotSessionStopped,
  hasFailedCopilotSession,
  hasFailingCheckRuns
} from '../lib/bumper.js';

describe('isCopilotPr', () => {
  it('should return true for copilot[bot] user', () => {
    const pr = {
      user: { login: 'copilot[bot]' },
      title: 'Fix bug',
      body: 'This fixes the issue'
    };
    expect(isCopilotPr(pr)).toBe(true);
  });

  it('should return true if title contains copilot', () => {
    const pr = {
      user: { login: 'someuser' },
      title: 'Copilot: Fix bug',
      body: 'This fixes the issue'
    };
    expect(isCopilotPr(pr)).toBe(true);
  });

  it('should return true if body contains copilot', () => {
    const pr = {
      user: { login: 'someuser' },
      title: 'Fix bug',
      body: 'Created by Copilot'
    };
    expect(isCopilotPr(pr)).toBe(true);
  });

  it('should return false for non-copilot PR', () => {
    const pr = {
      user: { login: 'someuser' },
      title: 'Fix bug',
      body: 'This fixes the issue'
    };
    expect(isCopilotPr(pr)).toBe(false);
  });

  it('should handle null body', () => {
    const pr = {
      user: { login: 'someuser' },
      title: 'Fix bug',
      body: null
    };
    expect(isCopilotPr(pr)).toBe(false);
  });
});

describe('isWip', () => {
  it('should return true for draft PR', () => {
    const pr = {
      title: 'Fix bug',
      draft: true
    };
    expect(isWip(pr)).toBe(true);
  });

  it('should return true if title contains WIP', () => {
    const pr = {
      title: 'WIP: Fix bug',
      draft: false
    };
    expect(isWip(pr)).toBe(true);
  });

  it('should return true if title contains wip (lowercase)', () => {
    const pr = {
      title: '[wip] Fix bug',
      draft: false
    };
    expect(isWip(pr)).toBe(true);
  });

  it('should return false for non-WIP, non-draft PR', () => {
    const pr = {
      title: 'Fix bug',
      draft: false
    };
    expect(isWip(pr)).toBe(false);
  });
});

describe('isStalled', () => {
  it('should return true for PR with no activity in past hour', () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const pr = {
      updated_at: twoHoursAgo.toISOString()
    };
    expect(isStalled(pr)).toBe(true);
  });

  it('should return false for PR updated within the hour', () => {
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
    const pr = {
      updated_at: thirtyMinutesAgo.toISOString()
    };
    expect(isStalled(pr)).toBe(false);
  });

  it('should return false for recently updated PR', () => {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const pr = {
      updated_at: fiveMinutesAgo.toISOString()
    };
    expect(isStalled(pr)).toBe(false);
  });

  it('should use custom threshold when provided', () => {
    const fortyMinutesAgo = new Date(Date.now() - 40 * 60 * 1000);
    const pr = {
      updated_at: fortyMinutesAgo.toISOString()
    };
    // With default 1 hour threshold, this should not be stalled
    expect(isStalled(pr)).toBe(false);
    // With 30 minute threshold, this should be stalled
    const thirtyMinutesMs = 30 * 60 * 1000;
    expect(isStalled(pr, thirtyMinutesMs)).toBe(true);
  });

  it('should return false when time is exactly at threshold', () => {
    // Test boundary: exactly at 30 minutes
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
    const pr = {
      updated_at: thirtyMinutesAgo.toISOString()
    };
    const thirtyMinutesMs = 30 * 60 * 1000;
    // Should be false because it's NOT greater than threshold
    expect(isStalled(pr, thirtyMinutesMs)).toBe(false);
  });

  it('should return true when time is just over threshold', () => {
    // Just over 30 minutes (30 minutes + 1 second)
    const justOverThirtyMinutes = new Date(Date.now() - (30 * 60 * 1000 + 1000));
    const pr = {
      updated_at: justOverThirtyMinutes.toISOString()
    };
    const thirtyMinutesMs = 30 * 60 * 1000;
    expect(isStalled(pr, thirtyMinutesMs)).toBe(true);
  });
});

describe('getTimeSinceUpdate', () => {
  it('should return time in milliseconds since last update', () => {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const pr = {
      updated_at: oneHourAgo.toISOString()
    };
    const timeSince = getTimeSinceUpdate(pr);
    // Allow 1 second tolerance for test execution time
    expect(timeSince).toBeGreaterThan(59 * 60 * 1000);
    expect(timeSince).toBeLessThan(61 * 60 * 1000);
  });
});

describe('findRelevantComment', () => {
  it('should filter out bump comments', () => {
    const comments = [
      { body: '@copilot still working?' },
      { body: 'This is the real comment' }
    ];
    const result = findRelevantComment(comments);
    expect(result.body).toBe('This is the real comment');
  });

  it('should return first relevant comment', () => {
    const comments = [
      { body: 'First relevant comment' },
      { body: 'Second relevant comment' }
    ];
    const result = findRelevantComment(comments);
    expect(result.body).toBe('First relevant comment');
  });

  it('should return undefined if no relevant comments', () => {
    const comments = [
      { body: '@copilot still working?' }
    ];
    const result = findRelevantComment(comments);
    expect(result).toBeUndefined();
  });

  it('should return undefined for empty array', () => {
    const result = findRelevantComment([]);
    expect(result).toBeUndefined();
  });
});

describe('filterPrNotifications', () => {
  it('should filter for PullRequest type', () => {
    const notifications = [
      { subject: { type: 'PullRequest' }, repository: { owner: { login: 'user1' } } },
      { subject: { type: 'Issue' }, repository: { owner: { login: 'user1' } } },
      { subject: { type: 'PullRequest' }, repository: { owner: { login: 'user1' } } }
    ];
    const result = filterPrNotifications(notifications);
    expect(result).toHaveLength(2);
    expect(result.every(n => n.subject.type === 'PullRequest')).toBe(true);
  });

  it('should return empty array if no PR notifications', () => {
    const notifications = [
      { subject: { type: 'Issue' }, repository: { owner: { login: 'user1' } } },
      { subject: { type: 'Commit' }, repository: { owner: { login: 'user1' } } }
    ];
    const result = filterPrNotifications(notifications);
    expect(result).toHaveLength(0);
  });

  it('should handle empty array', () => {
    const result = filterPrNotifications([]);
    expect(result).toHaveLength(0);
  });

  it('should filter by ownership when skipNonOwnedRepos is true', () => {
    const notifications = [
      { subject: { type: 'PullRequest' }, repository: { owner: { login: 'owner1' } } },
      { subject: { type: 'PullRequest' }, repository: { owner: { login: 'owner2' } } },
      { subject: { type: 'PullRequest' }, repository: { owner: { login: 'owner1' } } }
    ];
    const result = filterPrNotifications(notifications, {
      skipNonOwnedRepos: true,
      authenticatedUserLogin: 'owner1'
    });
    expect(result).toHaveLength(2);
    expect(result.every(n => n.repository.owner.login === 'owner1')).toBe(true);
  });

  it('should not filter by ownership when skipNonOwnedRepos is false', () => {
    const notifications = [
      { subject: { type: 'PullRequest' }, repository: { owner: { login: 'owner1' } } },
      { subject: { type: 'PullRequest' }, repository: { owner: { login: 'owner2' } } }
    ];
    const result = filterPrNotifications(notifications, {
      skipNonOwnedRepos: false,
      authenticatedUserLogin: 'owner1'
    });
    expect(result).toHaveLength(2);
  });
});

describe('shuffleArray', () => {
  it('should return array with same elements', () => {
    const original = [1, 2, 3, 4, 5];
    const shuffled = shuffleArray(original);
    expect(shuffled).toHaveLength(5);
    expect(shuffled.sort()).toEqual(original.sort());
  });

  it('should not modify original array', () => {
    const original = [1, 2, 3, 4, 5];
    const originalCopy = [...original];
    shuffleArray(original);
    expect(original).toEqual(originalCopy);
  });

  it('should handle empty array', () => {
    const result = shuffleArray([]);
    expect(result).toEqual([]);
  });

  it('should handle single element array', () => {
    const result = shuffleArray([1]);
    expect(result).toEqual([1]);
  });
});

describe('isIssueFixed', () => {
  it('should return false if no comment provided', async () => {
    const result = await isIssueFixed(null, {});
    expect(result).toBe(false);
  });

  it('should return false if no openai client provided', async () => {
    const result = await isIssueFixed({ body: 'Fixed!' }, null);
    expect(result).toBe(false);
  });

  it('should return false if both are null', async () => {
    const result = await isIssueFixed(null, null);
    expect(result).toBe(false);
  });

  it('should return true when AI responds YES', async () => {
    const mockOpenAI = {
      chat: {
        completions: {
          create: jest.fn().mockResolvedValue({
            choices: [{ message: { content: 'YES' } }]
          })
        }
      }
    };
    const result = await isIssueFixed({ body: 'Issue fixed!' }, mockOpenAI);
    expect(result).toBe(true);
  });

  it('should return false when AI responds NO', async () => {
    const mockOpenAI = {
      chat: {
        completions: {
          create: jest.fn().mockResolvedValue({
            choices: [{ message: { content: 'NO' } }]
          })
        }
      }
    };
    const result = await isIssueFixed({ body: 'Still working on it' }, mockOpenAI);
    expect(result).toBe(false);
  });

  it('should return false when AI throws error', async () => {
    const mockOpenAI = {
      chat: {
        completions: {
          create: jest.fn().mockRejectedValue(new Error('API Error'))
        }
      }
    };
    const result = await isIssueFixed({ body: 'Some comment' }, mockOpenAI);
    expect(result).toBe(false);
  });
});

describe('isCopilotError', () => {
  it('should return false if no comment provided', () => {
    expect(isCopilotError(null)).toBe(false);
  });

  it('should return false if comment has no body', () => {
    const comment = { user: { login: 'copilot[bot]' } };
    expect(isCopilotError(comment)).toBe(false);
  });

  it('should return false for non-copilot user comments', () => {
    const comment = {
      user: { login: 'someuser' },
      body: 'I encountered an error while processing'
    };
    expect(isCopilotError(comment)).toBe(false);
  });

  it('should return true for copilot error - encountered an error', () => {
    const comment = {
      user: { login: 'copilot[bot]' },
      body: 'I encountered an error while trying to implement this feature.'
    };
    expect(isCopilotError(comment)).toBe(true);
  });

  it('should return true for copilot error - ran into an error', () => {
    const comment = {
      user: { login: 'copilot[bot]' },
      body: 'I ran into an error processing the request.'
    };
    expect(isCopilotError(comment)).toBe(true);
  });

  it('should return true for copilot error - was unable to', () => {
    const comment = {
      user: { login: 'copilot[bot]' },
      body: 'I was unable to complete the task due to a configuration issue.'
    };
    expect(isCopilotError(comment)).toBe(true);
  });

  it('should return true for copilot error - apologize', () => {
    const comment = {
      user: { login: 'copilot[bot]' },
      body: 'I apologize, but I could not complete the task.'
    };
    expect(isCopilotError(comment)).toBe(true);
  });

  it('should return true for copilot error - unfortunately', () => {
    const comment = {
      user: { login: 'copilot[bot]' },
      body: 'Unfortunately, I was not able to finish the implementation.'
    };
    expect(isCopilotError(comment)).toBe(true);
  });

  it('should return true for copilot error - something went wrong', () => {
    const comment = {
      user: { login: 'copilot[bot]' },
      body: 'Something went wrong during the process.'
    };
    expect(isCopilotError(comment)).toBe(true);
  });

  it('should return false for copilot success message', () => {
    const comment = {
      user: { login: 'copilot[bot]' },
      body: 'I have successfully completed the implementation.'
    };
    expect(isCopilotError(comment)).toBe(false);
  });

  it('should return false for copilot work in progress message', () => {
    const comment = {
      user: { login: 'copilot[bot]' },
      body: 'I am currently working on this task.'
    };
    expect(isCopilotError(comment)).toBe(false);
  });

  it('should be case insensitive', () => {
    const comment = {
      user: { login: 'copilot[bot]' },
      body: 'I ENCOUNTERED AN ERROR while processing.'
    };
    expect(isCopilotError(comment)).toBe(true);
  });
});

describe('hasReviewComments', () => {
  it('should return false for null input', () => {
    expect(hasReviewComments(null)).toBe(false);
  });

  it('should return false for undefined input', () => {
    expect(hasReviewComments(undefined)).toBe(false);
  });

  it('should return false for non-array input', () => {
    expect(hasReviewComments('not an array')).toBe(false);
  });

  it('should return false for empty array', () => {
    expect(hasReviewComments([])).toBe(false);
  });

  it('should return true for array with review comments', () => {
    const reviewComments = [
      { id: 1, body: 'Please fix this', user: { login: 'reviewer' } }
    ];
    expect(hasReviewComments(reviewComments)).toBe(true);
  });

  it('should return true for array with multiple review comments', () => {
    const reviewComments = [
      { id: 1, body: 'Please fix this', user: { login: 'reviewer' } },
      { id: 2, body: 'Also fix this', user: { login: 'anotherreviewer' } }
    ];
    expect(hasReviewComments(reviewComments)).toBe(true);
  });
});

describe('findLatestReviewComment', () => {
  it('should return undefined for null input', () => {
    expect(findLatestReviewComment(null)).toBeUndefined();
  });

  it('should return undefined for undefined input', () => {
    expect(findLatestReviewComment(undefined)).toBeUndefined();
  });

  it('should return undefined for non-array input', () => {
    expect(findLatestReviewComment('not an array')).toBeUndefined();
  });

  it('should return undefined for empty array', () => {
    expect(findLatestReviewComment([])).toBeUndefined();
  });

  it('should return first non-copilot comment', () => {
    const reviewComments = [
      { id: 1, body: 'Please fix this', user: { login: 'reviewer' } },
      { id: 2, body: 'Also fix this', user: { login: 'anotherreviewer' } }
    ];
    const result = findLatestReviewComment(reviewComments);
    expect(result.id).toBe(1);
    expect(result.user.login).toBe('reviewer');
  });

  it('should skip copilot[bot] comments', () => {
    const reviewComments = [
      { id: 1, body: 'AI comment', user: { login: 'copilot[bot]' } },
      { id: 2, body: 'Please fix this', user: { login: 'reviewer' } }
    ];
    const result = findLatestReviewComment(reviewComments);
    expect(result.id).toBe(2);
    expect(result.user.login).toBe('reviewer');
  });

  it('should return undefined if all comments are from copilot[bot]', () => {
    const reviewComments = [
      { id: 1, body: 'AI comment 1', user: { login: 'copilot[bot]' } },
      { id: 2, body: 'AI comment 2', user: { login: 'copilot[bot]' } }
    ];
    expect(findLatestReviewComment(reviewComments)).toBeUndefined();
  });

  it('should skip comments with missing user field', () => {
    const reviewComments = [
      { id: 1, body: 'No user field' },
      { id: 2, body: 'Please fix this', user: { login: 'reviewer' } }
    ];
    const result = findLatestReviewComment(reviewComments);
    // The first comment has no user, so it should be skipped
    expect(result.id).toBe(2);
    expect(result.user.login).toBe('reviewer');
  });

  it('should return undefined if all comments have missing user fields', () => {
    const reviewComments = [
      { id: 1, body: 'No user field' },
      { id: 2, body: 'Also no user field' }
    ];
    expect(findLatestReviewComment(reviewComments)).toBeUndefined();
  });
});

describe('findRelevantComment with feedback comments', () => {
  it('should filter out feedback implementation comments', () => {
    const comments = [
      { body: '@copilot please implement the feedback left on this PR.' },
      { body: 'This is the real comment' }
    ];
    const result = findRelevantComment(comments);
    expect(result.body).toBe('This is the real comment');
  });

  it('should filter out both bump and feedback comments', () => {
    const comments = [
      { body: '@copilot still working?' },
      { body: '@copilot please implement the feedback left on this PR.' },
      { body: 'This is the real comment' }
    ];
    const result = findRelevantComment(comments);
    expect(result.body).toBe('This is the real comment');
  });

  it('should filter out merge conflict comments', () => {
    const comments = [
      { body: '@copilot There is a merge conflict with the base branch. Please merge in the base branch and resolve the conflicts.' },
      { body: 'This is the real comment' }
    ];
    const result = findRelevantComment(comments);
    expect(result.body).toBe('This is the real comment');
  });
});

describe('hasMergeConflict', () => {
  it('should return true when mergeable is false and mergeable_state is dirty', () => {
    const pr = {
      mergeable: false,
      mergeable_state: 'dirty'
    };
    expect(hasMergeConflict(pr)).toBe(true);
  });

  it('should return false when mergeable is true', () => {
    const pr = {
      mergeable: true,
      mergeable_state: 'clean'
    };
    expect(hasMergeConflict(pr)).toBe(false);
  });

  it('should return false when mergeable is null (GitHub still computing)', () => {
    const pr = {
      mergeable: null,
      mergeable_state: 'unknown'
    };
    expect(hasMergeConflict(pr)).toBe(false);
  });

  it('should return false when mergeable is false but state is not dirty', () => {
    const pr = {
      mergeable: false,
      mergeable_state: 'blocked'
    };
    expect(hasMergeConflict(pr)).toBe(false);
  });

  it('should return false when mergeable state is unstable', () => {
    const pr = {
      mergeable: true,
      mergeable_state: 'unstable'
    };
    expect(hasMergeConflict(pr)).toBe(false);
  });
});

describe('hasCopilotSessionStopped', () => {
  it('should return false for null input', () => {
    expect(hasCopilotSessionStopped(null)).toBe(false);
  });

  it('should return false for undefined input', () => {
    expect(hasCopilotSessionStopped(undefined)).toBe(false);
  });

  it('should return false for non-array input', () => {
    expect(hasCopilotSessionStopped('not an array')).toBe(false);
  });

  it('should return false for empty array', () => {
    expect(hasCopilotSessionStopped([])).toBe(false);
  });

  it('should return true when timeline contains copilot_session_stopped event', () => {
    const timelineEvents = [
      { event: 'commented' },
      { event: 'copilot_session_stopped' },
      { event: 'committed' }
    ];
    expect(hasCopilotSessionStopped(timelineEvents)).toBe(true);
  });

  it('should return false when timeline has no copilot_session_stopped event', () => {
    const timelineEvents = [
      { event: 'commented' },
      { event: 'committed' },
      { event: 'labeled' }
    ];
    expect(hasCopilotSessionStopped(timelineEvents)).toBe(false);
  });

  it('should return true for timeline with only copilot_session_stopped event', () => {
    const timelineEvents = [
      { event: 'copilot_session_stopped' }
    ];
    expect(hasCopilotSessionStopped(timelineEvents)).toBe(true);
  });

  it('should return true when multiple copilot_session_stopped events exist', () => {
    const timelineEvents = [
      { event: 'copilot_session_stopped' },
      { event: 'commented' },
      { event: 'copilot_session_stopped' }
    ];
    expect(hasCopilotSessionStopped(timelineEvents)).toBe(true);
  });
});

describe('hasFailedCopilotSession', () => {
  it('should return false for null input', () => {
    expect(hasFailedCopilotSession(null)).toBe(false);
  });

  it('should return false for undefined input', () => {
    expect(hasFailedCopilotSession(undefined)).toBe(false);
  });

  it('should return false for non-array input', () => {
    expect(hasFailedCopilotSession('not an array')).toBe(false);
  });

  it('should return false for empty array', () => {
    expect(hasFailedCopilotSession([])).toBe(false);
  });

  it('should return true when copilot_session_stopped event with failure outcome exists', () => {
    const timelineEvents = [
      { event: 'commented', actor: { login: 'user1' } },
      { event: 'copilot_session_stopped', copilot_session: { outcome: 'failure' } },
      { event: 'committed', actor: { login: 'copilot[bot]' } }
    ];
    expect(hasFailedCopilotSession(timelineEvents)).toBe(true);
  });

  it('should return false when copilot_session_stopped event has success outcome', () => {
    const timelineEvents = [
      { event: 'copilot_session_stopped', copilot_session: { outcome: 'success' } }
    ];
    expect(hasFailedCopilotSession(timelineEvents)).toBe(false);
  });

  it('should return false when no copilot_session_stopped event exists', () => {
    const timelineEvents = [
      { event: 'commented', actor: { login: 'user1' } },
      { event: 'committed', actor: { login: 'copilot[bot]' } }
    ];
    expect(hasFailedCopilotSession(timelineEvents)).toBe(false);
  });

  it('should return false when copilot_session field is missing', () => {
    const timelineEvents = [
      { event: 'copilot_session_stopped' }
    ];
    expect(hasFailedCopilotSession(timelineEvents)).toBe(false);
  });
});

describe('hasFailingCheckRuns', () => {
  it('should return false for null input', () => {
    expect(hasFailingCheckRuns(null)).toBe(false);
  });

  it('should return false for undefined input', () => {
    expect(hasFailingCheckRuns(undefined)).toBe(false);
  });

  it('should return false for non-array input', () => {
    expect(hasFailingCheckRuns('not an array')).toBe(false);
  });

  it('should return false for empty array', () => {
    expect(hasFailingCheckRuns([])).toBe(false);
  });

  it('should return true when check run has failure conclusion', () => {
    const checkRuns = [
      { name: 'test', conclusion: 'success' },
      { name: 'build', conclusion: 'failure' }
    ];
    expect(hasFailingCheckRuns(checkRuns)).toBe(true);
  });

  it('should return true when check run has action_required conclusion', () => {
    const checkRuns = [
      { name: 'test', conclusion: 'success' },
      { name: 'security', conclusion: 'action_required' }
    ];
    expect(hasFailingCheckRuns(checkRuns)).toBe(true);
  });

  it('should return true when check run has timed_out conclusion', () => {
    const checkRuns = [
      { name: 'test', conclusion: 'timed_out' }
    ];
    expect(hasFailingCheckRuns(checkRuns)).toBe(true);
  });

  it('should return false when all check runs have success conclusion', () => {
    const checkRuns = [
      { name: 'test', conclusion: 'success' },
      { name: 'build', conclusion: 'success' },
      { name: 'lint', conclusion: 'success' }
    ];
    expect(hasFailingCheckRuns(checkRuns)).toBe(false);
  });

  it('should return false when check runs have neutral or skipped conclusion', () => {
    const checkRuns = [
      { name: 'test', conclusion: 'neutral' },
      { name: 'build', conclusion: 'skipped' }
    ];
    expect(hasFailingCheckRuns(checkRuns)).toBe(false);
  });

  it('should return false when check runs are still in progress (null conclusion)', () => {
    const checkRuns = [
      { name: 'test', conclusion: null, status: 'in_progress' }
    ];
    expect(hasFailingCheckRuns(checkRuns)).toBe(false);
  });
});

describe('findRelevantComment with CI comments', () => {
  it('should filter out CI failure comments', () => {
    const comments = [
      { body: '@copilot The CI checks are failing. Please fix the failing tests or build issues.' },
      { body: 'This is the real comment' }
    ];
    const result = findRelevantComment(comments);
    expect(result.body).toBe('This is the real comment');
  });

  it('should filter out all bump comments including CI failure', () => {
    const comments = [
      { body: '@copilot still working?' },
      { body: '@copilot please implement the feedback left on this PR.' },
      { body: '@copilot There is a merge conflict with the base branch. Please merge in the base branch and resolve the conflicts.' },
      { body: '@copilot The CI checks are failing. Please fix the failing tests or build issues.' },
      { body: 'This is the real comment' }
    ];
    const result = findRelevantComment(comments);
    expect(result.body).toBe('This is the real comment');
  });
});
