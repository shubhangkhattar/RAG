/**
 * GitHubOidcStack — deployed ONCE per AWS account, not per stage.
 *
 * Creates:
 *   - GitHub Actions OIDC provider (the trust anchor that lets GitHub
 *     exchange a short-lived OIDC token for temporary AWS credentials)
 *   - IAM deploy role that GitHub Actions assumes via OIDC
 *
 * No long-lived access keys are stored in GitHub Secrets — the OIDC token is
 * valid only for the duration of the workflow run and is scoped to the
 * specific repository and branch.
 *
 * After deploying this stack, set these in your GitHub repository settings:
 *   Settings → Secrets and variables → Actions → Variables (not secrets):
 *     AWS_ACCOUNT_ID   — your 12-digit AWS account ID
 *     AWS_REGION       — e.g. us-east-1
 *   The role ARN is exported as a CloudFormation output.
 */
import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

interface GitHubOidcStackProps extends cdk.StackProps {
  // e.g. "my-org/my-repo"
  githubRepo: string;
  // Branches that are allowed to deploy. Defaults to main only.
  allowedBranches?: string[];
}

export class GitHubOidcStack extends cdk.Stack {
  public readonly deployRoleArn: string;

  constructor(scope: Construct, id: string, props: GitHubOidcStackProps) {
    super(scope, id, props);

    const allowedBranches = props.allowedBranches ?? ['main'];

    // GitHub's OIDC provider thumbprint is stable and published by GitHub.
    // https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/configuring-openid-connect-in-amazon-web-services
    const oidcProvider = new iam.OpenIdConnectProvider(this, 'GitHubOidcProvider', {
      url: 'https://token.actions.githubusercontent.com',
      clientIds: ['sts.amazonaws.com'],
    });

    // Conditions that must ALL be true for the role assumption to succeed:
    //   - The token was issued by GitHub Actions
    //   - The workflow is running from the configured repo
    //   - The workflow is running on an allowed branch
    const conditions: iam.Conditions = {
      StringEquals: {
        'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
        // Restrict to specific branches to prevent PRs from assuming the deploy role
        'token.actions.githubusercontent.com:sub': allowedBranches.map(
          (branch) => `repo:${props.githubRepo}:ref:refs/heads/${branch}`,
        ),
      },
    };

    const deployRole = new iam.Role(this, 'GitHubDeployRole', {
      roleName: 'rag-github-deploy-role',
      assumedBy: new iam.WebIdentityPrincipal(oidcProvider.openIdConnectProviderArn, conditions),
      description: 'Role assumed by GitHub Actions via OIDC to deploy the RAG system',
      maxSessionDuration: cdk.Duration.hours(1),
    });

    // ECR: push images
    deployRole.addToPolicy(new iam.PolicyStatement({
      sid: 'EcrPush',
      actions: [
        'ecr:GetAuthorizationToken',
        'ecr:BatchCheckLayerAvailability',
        'ecr:PutImage',
        'ecr:InitiateLayerUpload',
        'ecr:UploadLayerPart',
        'ecr:CompleteLayerUpload',
        'ecr:DescribeRepositories',
        'ecr:GetDownloadUrlForLayer',
        'ecr:BatchGetImage',
      ],
      resources: ['*'],
    }));

    // ECS: update services and task definitions
    deployRole.addToPolicy(new iam.PolicyStatement({
      sid: 'EcsDeploy',
      actions: [
        'ecs:DescribeServices',
        'ecs:DescribeTaskDefinition',
        'ecs:RegisterTaskDefinition',
        'ecs:UpdateService',
        'ecs:DescribeTasks',
        'ecs:ListTasks',
      ],
      resources: ['*'],
    }));

    // IAM: pass the ECS task execution role when registering task definitions
    deployRole.addToPolicy(new iam.PolicyStatement({
      sid: 'IamPassRole',
      actions: ['iam:PassRole'],
      resources: ['*'],
      conditions: {
        StringLike: { 'iam:PassedToService': 'ecs-tasks.amazonaws.com' },
      },
    }));

    // CloudFormation: read stack outputs (e.g. to get the ECR repo URI)
    deployRole.addToPolicy(new iam.PolicyStatement({
      sid: 'CfnRead',
      actions: ['cloudformation:DescribeStacks'],
      resources: ['*'],
    }));

    this.deployRoleArn = deployRole.roleArn;

    new cdk.CfnOutput(this, 'DeployRoleArn', {
      value: deployRole.roleArn,
      description: 'Set this as the role-to-assume in your GitHub Actions workflow',
    });
  }
}
