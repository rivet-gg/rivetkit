/**
 * Application configuration loaded from environment variables
 */

export interface Config {
  githubToken: string;
  linearApiKey: string;
  repoOwner: string;
  repoName: string;
  baseBranch: string;
}

/**
 * Load and validate configuration from environment variables
 */
export function getConfig(): Config {
  // Required environment variables
  const requiredEnvVars = [
    'GITHUB_TOKEN',
    'LINEAR_API_KEY',
    'ANTHROPIC_API_KEY',
    'REPO_OWNER',
    'REPO_NAME'
  ];

  // Check for missing environment variables
  const missingEnvVars = requiredEnvVars.filter(envVar => !process.env[envVar]);
  if (missingEnvVars.length > 0) {
    throw new Error(`Missing required environment variables: ${missingEnvVars.join(', ')}`);
  }

  return {
    githubToken: process.env.GITHUB_TOKEN!,
    linearApiKey: process.env.LINEAR_API_KEY!,
    repoOwner: process.env.REPO_OWNER!,
    repoName: process.env.REPO_NAME!,
    baseBranch: process.env.BASE_BRANCH || 'main',
  };
}
