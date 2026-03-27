/**
 * update-rules.ts
 *
 * CLI tool to push new rate-limit rules to AWS AppConfig.
 * The ECS AppConfig sidecar will pick up the change within ~15 seconds.
 *
 * Usage:
 *   npm run update-rules -- --app <app-id> --env <env-id> --profile <profile-id> --file <rules.json>
 *
 * Or with inline JSON:
 *   npm run update-rules -- --app <app-id> --env <env-id> --profile <profile-id> --rules '[{"prefix":"user","capacity":100,"refillRate":20}]'
 *
 * Example (minimal — updates only the user layer):
 *   npm run update-rules -- --app abc123 --env env456 --profile xyz789 --rules '[{"prefix":"user","capacity":100,"refillRate":20}]'
 */

import {
  AppConfigClient,
  CreateHostedConfigurationVersionCommand,
  StartDeploymentCommand,
  ListDeploymentStrategiesCommand,
} from '@aws-sdk/client-appconfig';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// ─── Argument Parsing ────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const get = (flag: string): string | undefined => {
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] : undefined;
};

const appId     = get('--app');
const envId     = get('--env');
const profileId = get('--profile');
const rulesFile = get('--file');
const rulesJson = get('--rules');
const region    = get('--region')  ?? 'ap-south-1';
const awsProfile = get('--aws-profile') ?? 'personal-ai';

if (!appId || !envId || !profileId) {
  console.error('❌  Usage: npm run update-rules -- --app <id> --env <id> --profile <id> [--file rules.json | --rules \'[...]\'] [--region ap-south-1] [--aws-profile personal-ai]');
  process.exit(1);
}

// ─── Load rules ──────────────────────────────────────────────────────────────
let content: string;
if (rulesFile) {
  content = readFileSync(resolve(process.cwd(), rulesFile), 'utf-8');
} else if (rulesJson) {
  content = rulesJson;
} else {
  console.error('❌  Provide either --file <path> or --rules \'<json>\'');
  process.exit(1);
}

// Validate JSON
try {
  const parsed = JSON.parse(content);
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('Rules must be a non-empty JSON array.');
  }
} catch (e) {
  console.error(`❌  Invalid rules JSON: ${(e as Error).message}`);
  process.exit(1);
}

// ─── AWS AppConfig ────────────────────────────────────────────────────────────
// Set AWS_PROFILE so the SDK default credential chain picks it up.
process.env.AWS_PROFILE = awsProfile;

const client = new AppConfigClient({ region });

async function run() {
  console.log('🔍  Looking up instant deployment strategy...');

  // Find the deployment strategy created by CDK
  const strategies = await client.send(new ListDeploymentStrategiesCommand({}));
  const strategy = strategies.Items?.find(
    (s) => s.Name === 'rate-limiter-instant' || s.Name === 'AppConfig.AllAtOnce',
  );

  if (!strategy?.Id) {
    console.error('❌  Could not find a deployment strategy. Use the AWS Console or pass a strategy ID directly.');
    process.exit(1);
  }

  console.log(`✅  Using strategy: "${strategy.Name}" (${strategy.Id})`);

  // 1. Create a new hosted config version
  console.log('📦  Creating new configuration version...');
  const versionResp = await client.send(
    new CreateHostedConfigurationVersionCommand({
      ApplicationId:          appId!,
      ConfigurationProfileId: profileId!,
      Content:                Buffer.from(content),
      ContentType:            'application/json',
    }),
  );

  const version = versionResp.VersionNumber;
  console.log(`✅  Created version: ${version}`);

  // 2. Deploy it
  console.log(`🚀  Deploying version ${version} to environment ${envId}...`);
  await client.send(
    new StartDeploymentCommand({
      ApplicationId:          appId!,
      EnvironmentId:          envId!,
      ConfigurationProfileId: profileId!,
      ConfigurationVersion:   String(version),
      DeploymentStrategyId:   strategy.Id,
    }),
  );

  console.log('');
  console.log('🔥  Deployment started! The ECS sidecar will pick this up in ~15 seconds.');
  console.log(`    Monitor: https://console.aws.amazon.com/systems-manager/appconfig`);
}

run().catch((err) => {
  console.error(`❌  ${(err as Error).message}`);
  process.exit(1);
});
