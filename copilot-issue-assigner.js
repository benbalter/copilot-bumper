import * as core from '@actions/core';
import github from '@actions/github';
import 'dotenv/config';

async function run() {
  try {
    const token = process.env.PAT;
    const dryRun = process.env.DRY_RUN === 'true';

    if (!token) {
      throw new Error('PAT not provided. Please set a Personal Access Token with appropriate permissions.');
    }

    console.log(`🚀 Starting Copilot Issue Assigner${dryRun ? ' (DRY RUN MODE)' : ''}`);
    const octokit = github.getOctokit(token);
    
    // Get the authenticated user
    const { data: authenticatedUser } = await octokit.rest.users.getAuthenticated();
    console.log(`Authenticated as ${authenticatedUser.login}`);
    
    // Get all repositories owned by the authenticated user
    console.log(`Fetching repositories owned by ${authenticatedUser.login}...`);
    const { data: repos } = await octokit.rest.repos.listForAuthenticatedUser({
      type: 'owner',
      per_page: 100
    });
    
    console.log(`Found ${repos.length} repositories owned by ${authenticatedUser.login}`);
    
    let totalIssuesAssigned = 0;
    
    // Process repositories
    for (const repo of repos) {
      if (repo.owner.login !== authenticatedUser.login) {
        continue; // Skip repos not owned by the authenticated user
      }
      
      console.log(`Processing repository: ${repo.full_name}`);
      
      // Find all open issues in the repository
      const { data: issues } = await octokit.rest.issues.listForRepo({
        owner: repo.owner.login,
        repo: repo.name,
        state: 'open',
        per_page: 100
      });
      
      const actualIssues = issues.filter(issue => !issue.pull_request); // Exclude PRs
      console.log(`Found ${actualIssues.length} open issues in ${repo.full_name}`);
      
      // Assign Copilot to each open issue
      for (const issue of actualIssues) {
        const isAssigned = issue.assignees.some(assignee => 
          assignee.login === 'copilot[bot]' || assignee.login === 'Copilot');
        
        if (isAssigned) {
          console.log(`Issue #${issue.number} in ${repo.full_name} is already assigned to Copilot. Skipping.`);
          continue;
        }
        
        console.log(`Assigning Copilot to issue #${issue.number} in ${repo.full_name}...`);
        
        if (!dryRun) {
          try {
            await octokit.rest.issues.addAssignees({
              owner: repo.owner.login,
              repo: repo.name,
              issue_number: issue.number,
              assignees: ['Copilot']
            });
            console.log(`✅ Successfully assigned Copilot to issue #${issue.number} in ${repo.full_name}`);
            totalIssuesAssigned++;
          } catch (error) {
            console.error(`❌ Error assigning Copilot to issue #${issue.number} in ${repo.full_name}:`, error.message);
          }
        } else {
          console.log(`[DRY RUN] Would have assigned Copilot to issue #${issue.number} in ${repo.full_name}`);
          totalIssuesAssigned++;
        }
      }
    }
    
    console.log(`✅ Copilot Issue Assigner completed. Assigned ${totalIssuesAssigned} issues${dryRun ? ' (dry run)' : ''}.`);
  } catch (error) {
    core.setFailed(`Action failed with error: ${error.message}`);
    console.error('Error details:', error);
  }
}

run();