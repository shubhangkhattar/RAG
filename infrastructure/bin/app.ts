#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { NetworkStack } from '../lib/stacks/network-stack';
import { StorageStack } from '../lib/stacks/storage-stack';
import { OpenSearchStack } from '../lib/stacks/opensearch-stack';
import { CacheStack } from '../lib/stacks/cache-stack';
import { IngestionStack } from '../lib/stacks/ingestion-stack';
import { ApiStack } from '../lib/stacks/api-stack';
import { ObservabilityStack } from '../lib/stacks/observability-stack';
import { GitHubOidcStack } from '../lib/stacks/github-oidc-stack';
import { FrontendStack } from '../lib/stacks/frontend-stack';
import { configs } from '../lib/config';

const app = new cdk.App();

const stage = (app.node.tryGetContext('stage') as string) ?? 'dev';
const config = configs[stage];
if (!config) {
  throw new Error(`Unknown stage "${stage}". Valid values: test, dev, prod`);
}

const env: cdk.Environment = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
};

const tags = {
  Project: 'enterprise-rag',
  Stage: stage,
  ManagedBy: 'cdk',
  Ephemeral: String(config.ephemeral),
};

// ── Layer 1: Networking ──────────────────────────────────────────────────────
const network = new NetworkStack(app, `RagNetwork-${stage}`, {
  env,
  stage,
  skipVpcEndpoints: config.skipVpcEndpoints,
  tags,
});

// ── Layer 2: Storage ─────────────────────────────────────────────────────────
const storage = new StorageStack(app, `RagStorage-${stage}`, {
  env,
  stage,
  ephemeral: config.ephemeral,
  tags,
});

// ── Layer 3: Data plane — OpenSearch + Cache ─────────────────────────────────
const openSearch = new OpenSearchStack(app, `RagOpenSearch-${stage}`, {
  env,
  stage,
  vpc: network.vpc,
  vpcCidr: network.vpcCidr,
  isolatedSubnets: network.isolatedSubnets,
  config,
  tags,
});

const cache = new CacheStack(app, `RagCache-${stage}`, {
  env,
  stage,
  vpc: network.vpc,
  vpcCidr: network.vpcCidr,
  privateSubnets: network.privateSubnets,
  config,
  tags,
});

// ── Layer 4: Ingestion pipeline ──────────────────────────────────────────────
new IngestionStack(app, `RagIngestion-${stage}`, {
  env,
  stage,
  vpc: network.vpc,
  privateSubnets: network.privateSubnets,
  rawDocsBucket: storage.rawDocsBucket,
  processedDocsBucket: storage.processedDocsBucket,
  openSearchDomain: openSearch.domain,
  encryptionKey: storage.encryptionKey,
  tags,
});

// ── Layer 5: API service ─────────────────────────────────────────────────────
new ApiStack(app, `RagApi-${stage}`, {
  env,
  stage,
  vpc: network.vpc,
  vpcCidr: network.vpcCidr,
  publicSubnets: network.publicSubnets,
  privateSubnets: network.privateSubnets,
  openSearchDomain: openSearch.domain,
  sessionsTable: storage.sessionsTable,
  rawDocsBucket: storage.rawDocsBucket,
  cacheReplicationGroup: cache.replicationGroup,
  encryptionKey: storage.encryptionKey,
  config,
  tags,
});

// ── Layer 6: Frontend (S3 + CloudFront) ──────────────────────────────────────
new FrontendStack(app, `RagFrontend-${stage}`, {
  env,
  stage,
  ephemeral: config.ephemeral,
  tags,
});

// ── Layer 7: Observability — skipped for ephemeral stacks ────────────────────
// Dashboards and alarms are not useful for short-lived test deployments.
if (!config.ephemeral) {
  new ObservabilityStack(app, `RagObservability-${stage}`, {
    env,
    stage,
    alarmEmail: app.node.tryGetContext('alarmEmail') as string | undefined,
    tags,
  });
}

// ── Layer 8: GitHub OIDC — skipped for ephemeral stacks ──────────────────────
// Deploy once per account: cdk deploy RagGitHubOidc --context githubRepo=org/repo
const githubRepo = app.node.tryGetContext('githubRepo') as string | undefined;
if (githubRepo && !config.ephemeral) {
  new GitHubOidcStack(app, 'RagGitHubOidc', {
    env,
    githubRepo,
    allowedBranches: ['main'],
    tags: { Project: 'enterprise-rag', ManagedBy: 'cdk' },
  });
}

app.synth();
