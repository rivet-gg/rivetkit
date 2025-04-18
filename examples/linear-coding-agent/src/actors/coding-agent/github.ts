import { Octokit } from "@octokit/rest";
import type { GitHubFile, GitHubFileContent, PullRequestInfo } from "./types";
import type { Ctx } from "./mod";
import { getConfig } from "../../config";


/**
 * Push changes to GitHub and refresh file tree
 */
export async function pushChangesToGitHub(c: Ctx, commitMessage: string) {
  // Skip if no files were modified
  if (Object.keys(c.state.code.modifiedFiles).length === 0) {
    console.log('[GITHUB] No files modified, skipping push to GitHub');
    return true;
  }

  console.log(`[GITHUB] Pushing changes to GitHub: ${Object.keys(c.state.code.modifiedFiles).length} files modified`);
  console.log(`[GITHUB] Branch: ${c.state.github.branchName}, Commit message: ${commitMessage}`);

  // Push changes to GitHub
  const result = await commitChanges(
    c,
    c.state.code.modifiedFiles,
    c.state.github.branchName,
    commitMessage
  );

  if (result) {
    console.log(`[GITHUB] Successfully pushed changes to branch: ${c.state.github.branchName}`);
    
    // Successfully pushed changes, clear modified files
    c.state.code.modifiedFiles = {};

    // Refresh file tree
    c.state.code.fileTree = await getFileTree(c, c.state.github.branchName);
  } else {
    console.error(`[GITHUB] Failed to push changes to branch: ${c.state.github.branchName}`);
  }

  return result;
}

/**
 * Create a new branch from the specified base branch
 */
export async function createBranch(c: Ctx, branchName: string, baseBranch: string): Promise<boolean> {
  try {
    console.log(`[GITHUB] Creating new branch: ${branchName} from ${baseBranch}`);
    
    const config = getConfig();
    const octokit = new Octokit({ auth: config.githubToken });
    
    // Get the SHA of the base branch
    const { data: refData } = await octokit.git.getRef({
      owner: c.state.github.owner,
      repo: c.state.github.repo,
      ref: `heads/${baseBranch}`,
    });

    console.log(`[GITHUB] Retrieved base branch reference: ${baseBranch} (${refData.object.sha})`);

    // Create a new branch
    await octokit.git.createRef({
      owner: c.state.github.owner,
      repo: c.state.github.repo,
      ref: `refs/heads/${branchName}`,
      sha: refData.object.sha,
    });

    console.log(`[GITHUB] Branch created successfully: ${branchName}`);
    return true;
  } catch (error) {
    console.error(`[GITHUB] Failed to create branch ${branchName}:`, error);
    return false;
  }
}

/**
 * Get the file tree for the specified branch
 */
export async function getFileTree(c: Ctx, branch: string): Promise<GitHubFile[]> {
  try {
    console.log(`[GITHUB] Fetching file tree for ${c.state.github.repo} (${branch})`);
    
    const config = getConfig();
    const octokit = new Octokit({ auth: config.githubToken });
    
    // Get the latest commit on the branch
    const { data: refData } = await octokit.git.getRef({
      owner: c.state.github.owner,
      repo: c.state.github.repo,
      ref: `heads/${branch}`,
    });

    // Get the tree of that commit
    const { data: treeData } = await octokit.git.getTree({
      owner: c.state.github.owner,
      repo: c.state.github.repo,
      tree_sha: refData.object.sha,
      recursive: "1",
    });

    // Map to our GitHubFile type
    const files = treeData.tree.map((item) => ({
      path: item.path || "",
      type: item.type === "blob" ? "file" : "directory" as "file" | "directory",
      sha: item.sha,
    }));

    console.log(`[GITHUB] File tree fetched successfully: ${files.length} files`);
    return files;
  } catch (error) {
    console.error(`[GITHUB] Failed to get file tree for branch ${branch}:`, error);
    return [];
  }
}

/**
 * Read the contents of a file from the specified branch
 */
export async function readFile(c: Ctx, path: string, branch: string): Promise<GitHubFileContent | null> {
  try {
    const config = getConfig();
    const octokit = new Octokit({ auth: config.githubToken });
    
    const { data } = await octokit.repos.getContent({
      owner: c.state.github.owner,
      repo: c.state.github.repo,
      path,
      ref: branch,
    });

    // Handle case when data is an array (directory) instead of a file
    if (Array.isArray(data)) {
      throw new Error(`Path ${path} is a directory, not a file`);
    }

    // Handle case where content might be undefined
    if (!("content" in data)) {
      throw new Error(`No content found for ${path}`);
    }

    // Decode base64 content
    const content = Buffer.from(data.content, "base64").toString();

    return {
      content,
      sha: data.sha,
      path,
    };
  } catch (error) {
    console.error(`[GITHUB] Failed to read file ${path}:`, error);
    return null;
  }
}

/**
 * Read multiple files at once
 */
export async function readFiles(c: Ctx, paths: string[], branch: string): Promise<Record<string, GitHubFileContent | null>> {
  const results: Record<string, GitHubFileContent | null> = {};
  await Promise.all(
    paths.map(async (path) => {
      results[path] = await readFile(c, path, branch);
    }),
  );
  return results;
}

/**
 * Commit changes to files
 */
export async function commitChanges(
  c: Ctx,
  files: Record<string, string>,
  branch: string,
  message: string,
): Promise<boolean> {
  try {
    console.log(`[GITHUB] Committing changes to ${branch}: ${Object.keys(files).length} files modified`);
    
    const config = getConfig();
    const octokit = new Octokit({ auth: config.githubToken });
    
    // First get the current commit to use as parent
    const { data: refData } = await octokit.git.getRef({
      owner: c.state.github.owner,
      repo: c.state.github.repo,
      ref: `heads/${branch}`,
    });
    const commitSha = refData.object.sha;

    // Get the current tree
    const { data: commitData } = await octokit.git.getCommit({
      owner: c.state.github.owner,
      repo: c.state.github.repo,
      commit_sha: commitSha,
    });
    const treeSha = commitData.tree.sha;

    // Create blobs for each file
    const blobPromises = Object.entries(files).map(
      async ([path, content]) => {
        const { data } = await octokit.git.createBlob({
          owner: c.state.github.owner,
          repo: c.state.github.repo,
          content,
          encoding: "utf-8",
        });
        return {
          path,
          mode: "100644" as const, // Regular file
          type: "blob" as const,
          sha: data.sha,
        };
      },
    );

    const blobs = await Promise.all(blobPromises);

    // Create a new tree
    const { data: newTree } = await octokit.git.createTree({
      owner: c.state.github.owner,
      repo: c.state.github.repo,
      base_tree: treeSha,
      tree: blobs,
    });

    // Create a new commit
    const { data: newCommit } = await octokit.git.createCommit({
      owner: c.state.github.owner,
      repo: c.state.github.repo,
      message,
      tree: newTree.sha,
      parents: [commitSha],
    });

    // Update the reference
    await octokit.git.updateRef({
      owner: c.state.github.owner,
      repo: c.state.github.repo,
      ref: `heads/${branch}`,
      sha: newCommit.sha,
    });

    console.log(`[GITHUB] Changes committed successfully to ${branch}`); 
    return true;
  } catch (error) {
    console.error(`[GITHUB] Failed to commit changes to ${branch}:`, error);
    return false;
  }
}

/**
 * Create a pull request
 */
export async function createPullRequest(
  c: Ctx,
  title: string,
  body: string,
  head: string,
  base: string,
): Promise<PullRequestInfo | null> {
  try {
    console.log(`[GITHUB] Creating pull request: ${head} → ${base}`);
    console.log(`[GITHUB] PR title: ${title}`);
    
    const config = getConfig();
    const octokit = new Octokit({ auth: config.githubToken });
    
    // First check if there are any commits between branches
    try {
      const { data: comparison } = await octokit.repos.compareCommits({
        owner: c.state.github.owner,
        repo: c.state.github.repo,
        base,
        head,
      });
      
      if (comparison.total_commits === 0) {
        console.error(`[GITHUB] Cannot create PR: No commits between ${base} and ${head}`);
        return {
          id: 0,
          number: 0,
          url: `https://github.com/${c.state.github.owner}/${c.state.github.repo}/tree/${head}`,
          noDiff: true
        };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.warn(`[GITHUB] Could not compare branches: ${errorMessage}`);
      // Continue anyway and let the PR creation attempt fail if needed
    }
    
    const { data } = await octokit.pulls.create({
      owner: c.state.github.owner,
      repo: c.state.github.repo,
      title,
      body,
      head,
      base,
    });

    console.log(`[GITHUB] Pull request created successfully: #${data.number} (${data.html_url})`);
    
    return {
      id: data.id,
      number: data.number,
      url: data.html_url,
    };
  } catch (error) {
    if (error instanceof Error && error.message && error.message.includes("No commits between")) {
      console.error(`[GITHUB] Failed to create PR: No commits between branches`);
      return {
        id: 0,
        number: 0,
        url: `https://github.com/${c.state.github.owner}/${c.state.github.repo}/tree/${head}`,
        noDiff: true
      };
    }
    
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[GITHUB] Failed to create pull request:`, errorMessage);
    return null;
  }
}

/**
 * Merge a pull request
 */
export async function mergePullRequest(c: Ctx, prNumber: number): Promise<boolean> {
  try {
    console.log(`[GITHUB] Merging pull request #${prNumber}`);
    
    const config = getConfig();
    const octokit = new Octokit({ auth: config.githubToken });
    
    await octokit.pulls.merge({
      owner: c.state.github.owner,
      repo: c.state.github.repo,
      pull_number: prNumber,
    });
    
    console.log(`[GITHUB] Pull request #${prNumber} merged successfully`);
    return true;
  } catch (error) {
    console.error(`[GITHUB] Failed to merge PR #${prNumber}:`, error);
    return false;
  }
}

/**
 * Close a pull request
 */
export async function closePullRequest(c: Ctx, prNumber: number): Promise<boolean> {
  try {
    console.log(`[GITHUB] Closing pull request #${prNumber}`);
    
    const config = getConfig();
    const octokit = new Octokit({ auth: config.githubToken });
    
    await octokit.pulls.update({
      owner: c.state.github.owner,
      repo: c.state.github.repo,
      pull_number: prNumber,
      state: "closed",
    });
    
    console.log(`[GITHUB] Pull request #${prNumber} closed successfully`);
    return true;
  } catch (error) {
    console.error(`[GITHUB] Failed to close PR #${prNumber}:`, error);
    return false;
  }
}