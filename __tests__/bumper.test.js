import { jest } from '@jest/globals';
import {
  isCopilotPr,
  isWip,
  isStalled,
  getTimeSinceUpdate,
  findRelevantComment,
  filterPrNotifications,
  shuffleArray,
  isIssueFixed
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
      { subject: { type: 'PullRequest' } },
      { subject: { type: 'Issue' } },
      { subject: { type: 'PullRequest' } }
    ];
    const result = filterPrNotifications(notifications);
    expect(result).toHaveLength(2);
    expect(result.every(n => n.subject.type === 'PullRequest')).toBe(true);
  });

  it('should return empty array if no PR notifications', () => {
    const notifications = [
      { subject: { type: 'Issue' } },
      { subject: { type: 'Commit' } }
    ];
    const result = filterPrNotifications(notifications);
    expect(result).toHaveLength(0);
  });

  it('should handle empty array', () => {
    const result = filterPrNotifications([]);
    expect(result).toHaveLength(0);
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
