import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigwIntegrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as apigwAuthorizers from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as opensearch from 'aws-cdk-lib/aws-opensearchservice';
import * as elasticache from 'aws-cdk-lib/aws-elasticache';
import { Construct } from 'constructs';
import { RagConfig } from '../config';

interface ApiStackProps extends cdk.StackProps {
  stage: string;
  vpc: ec2.Vpc;
  vpcCidr: string;
  publicSubnets: ec2.ISubnet[];
  privateSubnets: ec2.ISubnet[];
  openSearchDomain: opensearch.Domain;
  sessionsTable: dynamodb.Table;
  rawDocsBucket: s3.IBucket;
  cacheReplicationGroup: elasticache.CfnReplicationGroup;
  encryptionKey: kms.Key;
  config: RagConfig;
}

export class ApiStack extends cdk.Stack {
  public readonly apiEndpoint: string;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    // ── Cognito ──────────────────────────────────────────────────────────────
    const userPool = new cognito.UserPool(this, 'RagUserPool', {
      userPoolName: `rag-users-${props.stage}`,
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      standardAttributes: { email: { required: true, mutable: false } },
      // Custom attribute carries the user's namespace (department/tenant)
      customAttributes: {
        namespace: new cognito.StringAttribute({ mutable: true }),
        roles: new cognito.StringAttribute({ mutable: true }),
      },
      passwordPolicy: {
        minLength: 12,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
        tempPasswordValidity: cdk.Duration.days(3),
      },
      mfa: cognito.Mfa.OPTIONAL,
      mfaSecondFactor: { sms: false, otp: true },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: props.config.ephemeral ? cdk.RemovalPolicy.DESTROY : cdk.RemovalPolicy.RETAIN,
    });

    userPool.addDomain('UserPoolDomain', {
      cognitoDomain: { domainPrefix: `rag-${props.stage}-${this.account}` },
    });

    const userPoolClient = new cognito.UserPoolClient(this, 'UserPoolClient', {
      userPool,
      userPoolClientName: `rag-api-client-${props.stage}`,
      authFlows: { userPassword: true, userSrp: true },
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [cognito.OAuthScope.EMAIL, cognito.OAuthScope.OPENID, cognito.OAuthScope.PROFILE],
      },
      accessTokenValidity: cdk.Duration.hours(1),
      idTokenValidity: cdk.Duration.hours(1),
      refreshTokenValidity: cdk.Duration.days(30),
      preventUserExistenceErrors: true,
    });

    // ── ECR ──────────────────────────────────────────────────────────────────
    const ecrRepo = new ecr.Repository(this, 'ApiRepo', {
      repositoryName: `rag-api-${props.stage}`,
      encryptionKey: props.encryptionKey,
      encryption: ecr.RepositoryEncryption.KMS,
      imageScanOnPush: !props.config.ephemeral,  // scan costs time; skip for test
      imageTagMutability: props.config.ephemeral
        ? ecr.TagMutability.MUTABLE        // re-tag freely in test
        : ecr.TagMutability.IMMUTABLE,
      removalPolicy: props.config.ephemeral ? cdk.RemovalPolicy.DESTROY : cdk.RemovalPolicy.RETAIN,
      // Keep image count low for test; prod keeps 10 for rollback
      lifecycleRules: [{ maxImageCount: props.config.ephemeral ? 3 : 10 }],
    });

    // ── ECS cluster ──────────────────────────────────────────────────────────
    const cluster = new ecs.Cluster(this, 'RagCluster', {
      clusterName: `rag-cluster-${props.stage}`,
      vpc: props.vpc,
      containerInsights: !props.config.ephemeral, // Container Insights costs ~$1/task/month
    });

    // Task role: what the running container is allowed to call
    const taskRole = new iam.Role(this, 'ApiTaskRole', {
      roleName: `rag-api-task-${props.stage}`,
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
    });
    props.sessionsTable.grantReadWriteData(taskRole);
    props.encryptionKey.grantEncryptDecrypt(taskRole);
    props.openSearchDomain.grantReadWrite(taskRole);
    taskRole.addToPolicy(new iam.PolicyStatement({
      sid: 'BedrockInvoke',
      actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
      resources: [
        `arn:aws:bedrock:${this.region}::foundation-model/anthropic.claude-3-sonnet-20240229-v1:0`,
        `arn:aws:bedrock:${this.region}::foundation-model/amazon.titan-embed-text-v2:0`,
      ],
    }));
    // Admin: generate presigned PUT URLs so the UI uploads directly to S3
    props.rawDocsBucket.grantPut(taskRole);
    // Admin: list raw + processed objects to show ingestion status in the UI
    props.rawDocsBucket.grantRead(taskRole);
    // Admin: Cognito user management (create, list, update, delete users)
    taskRole.addToPolicy(new iam.PolicyStatement({
      sid: 'CognitoAdminOps',
      actions: [
        'cognito-idp:ListUsers',
        'cognito-idp:AdminCreateUser',
        'cognito-idp:AdminDeleteUser',
        'cognito-idp:AdminUpdateUserAttributes',
        'cognito-idp:AdminSetUserPassword',
        'cognito-idp:AdminGetUser',
      ],
      resources: [`arn:aws:cognito-idp:${this.region}:${this.account}:userpool/*`],
    }));

    // Execution role: what ECS control plane can do to start the task
    const executionRole = new iam.Role(this, 'ApiExecutionRole', {
      roleName: `rag-api-execution-${props.stage}`,
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'),
      ],
    });
    props.encryptionKey.grantDecrypt(executionRole);

    // ── Task definition ──────────────────────────────────────────────────────
    const logGroup = new logs.LogGroup(this, 'ApiLogGroup', {
      logGroupName: `/rag/api/${props.stage}`,
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const cfg = props.config.api;
    const taskDef = new ecs.FargateTaskDefinition(this, 'ApiTaskDef', {
      cpu: cfg.cpu,
      memoryLimitMiB: cfg.memoryMiB,
      taskRole,
      executionRole,
      runtimePlatform: {
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
        cpuArchitecture: ecs.CpuArchitecture.ARM64,
      },
    });

    const container = taskDef.addContainer('ApiContainer', {
      image: ecs.ContainerImage.fromEcrRepository(ecrRepo, 'latest'),
      logging: ecs.LogDrivers.awsLogs({ logGroup, streamPrefix: 'api' }),
      environment: {
        STAGE: props.stage,
        OPENSEARCH_ENDPOINT: props.openSearchDomain.domainEndpoint,
        SESSIONS_TABLE: props.sessionsTable.tableName,
        CACHE_HOST: props.cacheReplicationGroup.attrPrimaryEndPointAddress,
        CACHE_PORT: props.cacheReplicationGroup.attrPrimaryEndPointPort,
        COGNITO_USER_POOL_ID: userPool.userPoolId,
        RAW_DOCS_BUCKET: props.rawDocsBucket.bucketName,
        AWS_DEFAULT_REGION: this.region,
      },
      healthCheck: {
        command: ['CMD-SHELL', 'curl -sf http://localhost:8000/health || exit 1'],
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
        retries: 3,
        startPeriod: cdk.Duration.seconds(60),
      },
    });
    container.addPortMappings({ containerPort: 8000, protocol: ecs.Protocol.TCP });

    // ── Security groups ──────────────────────────────────────────────────────
    // ALB is internal: API Gateway VPC Link is the only ingress path.
    const albSg = new ec2.SecurityGroup(this, 'AlbSg', {
      vpc: props.vpc,
      description: 'Internal ALB - receive traffic from API GW VPC Link',
      allowAllOutbound: false,
    });
    albSg.addIngressRule(
      ec2.Peer.ipv4(props.vpcCidr),
      ec2.Port.tcp(80),
      'HTTP from VPC CIDR (API GW VPC Link)',
    );

    const serviceSg = new ec2.SecurityGroup(this, 'ApiServiceSg', {
      vpc: props.vpc,
      description: 'ECS API service',
      allowAllOutbound: true,
    });
    serviceSg.addIngressRule(albSg, ec2.Port.tcp(8000), 'ALB to container port 8000');

    // ── Internal ALB (TLS terminated at API Gateway, not here) ───────────────
    const alb = new elbv2.ApplicationLoadBalancer(this, 'ApiAlb', {
      vpc: props.vpc,
      internetFacing: false,          // API GW handles internet exposure + TLS
      vpcSubnets: { subnets: props.privateSubnets },
      securityGroup: albSg,
      deletionProtection: props.stage === 'prod',
    });

    // No default action here - addTargets below sets it, avoiding a CDK warning
    // about duplicate default actions on the same listener.
    const httpListener = alb.addListener('HttpListener', {
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      open: false,
    });

    // ── ECS service ──────────────────────────────────────────────────────────
    const service = new ecs.FargateService(this, 'ApiService', {
      serviceName: `rag-api-${props.stage}`,
      cluster,
      taskDefinition: taskDef,
      // Ephemeral stacks start at 0 tasks — no Docker image exists in ECR yet at deploy time.
      // After pushing the image, run:
      //   aws ecs update-service --cluster rag-cluster-<stage> --service rag-api-<stage> --desired-count 1
      desiredCount: props.config.ephemeral ? 0 : cfg.desiredCount,
      vpcSubnets: { subnets: props.privateSubnets },
      securityGroups: [serviceSg],
      assignPublicIp: false,
      // Circuit breaker only on persistent stacks — ephemeral has desiredCount 0 so nothing to check
      circuitBreaker: props.config.ephemeral ? undefined : { rollback: true },
      enableECSManagedTags: true,
      propagateTags: ecs.PropagatedTagSource.TASK_DEFINITION,
      minHealthyPercent: cfg.desiredCount > 1 ? 100 : 50,
      maxHealthyPercent: 200,
    });

    const targetGroup = httpListener.addTargets('ApiTargets', {
      targetGroupName: `rag-api-tg-${props.stage}`,
      port: 8000,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [service],
      healthCheck: {
        path: '/health',
        interval: cdk.Duration.seconds(30),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 3,
      },
      deregistrationDelay: cdk.Duration.seconds(30),
    });

    // Auto-scaling on CPU (scale out fast, scale in slow)
    const scaling = service.autoScaleTaskCount({ maxCapacity: cfg.maxCount, minCapacity: 1 });
    scaling.scaleOnCpuUtilization('CpuScaling', {
      targetUtilizationPercent: 70,
      scaleInCooldown: cdk.Duration.seconds(120),
      scaleOutCooldown: cdk.Duration.seconds(30),
    });
    scaling.scaleOnRequestCount('RequestScaling', {
      requestsPerTarget: 500,
      targetGroup,
      scaleInCooldown: cdk.Duration.seconds(120),
      scaleOutCooldown: cdk.Duration.seconds(30),
    });

    // ── API Gateway (HTTP) with Cognito JWT authorizer ────────────────────────
    const authorizer = new apigwAuthorizers.HttpUserPoolAuthorizer(
      'CognitoAuthorizer',
      userPool,
      { userPoolClients: [userPoolClient] },
    );

    const vpcLink = new apigwv2.VpcLink(this, 'VpcLink', {
      vpc: props.vpc,
      subnets: { subnets: props.privateSubnets },
      securityGroups: [albSg],
    });

    const albIntegration = new apigwIntegrations.HttpAlbIntegration(
      'AlbIntegration',
      httpListener,
      { vpcLink },
    );

    const httpApi = new apigwv2.HttpApi(this, 'RagHttpApi', {
      apiName: `rag-api-${props.stage}`,
      defaultAuthorizer: authorizer,
      corsPreflight: {
        allowHeaders: ['Content-Type', 'Authorization'],
        allowMethods: [
          apigwv2.CorsHttpMethod.GET,
          apigwv2.CorsHttpMethod.POST,
          apigwv2.CorsHttpMethod.OPTIONS,
        ],
        allowOrigins: ['*'],
        maxAge: cdk.Duration.days(1),
      },
    });

    // Authenticated routes
    httpApi.addRoutes({
      path: '/v1/{proxy+}',
      methods: [apigwv2.HttpMethod.ANY],
      integration: albIntegration,
      authorizer,
    });

    // Unauthenticated health probe — explicitly override the defaultAuthorizer with NONE
    httpApi.addRoutes({
      path: '/health',
      methods: [apigwv2.HttpMethod.GET],
      integration: albIntegration,
      authorizer: new apigwv2.HttpNoneAuthorizer(),
    });

    this.apiEndpoint = httpApi.apiEndpoint;

    new cdk.CfnOutput(this, 'ApiEndpoint', {
      value: httpApi.apiEndpoint,
      exportName: `rag-api-endpoint-${props.stage}`,
    });
    new cdk.CfnOutput(this, 'UserPoolId', {
      value: userPool.userPoolId,
      exportName: `rag-user-pool-id-${props.stage}`,
    });
    new cdk.CfnOutput(this, 'UserPoolClientId', {
      value: userPoolClient.userPoolClientId,
      exportName: `rag-user-pool-client-id-${props.stage}`,
    });
    new cdk.CfnOutput(this, 'EcrRepoUri', {
      value: ecrRepo.repositoryUri,
      exportName: `rag-ecr-uri-${props.stage}`,
    });
    new cdk.CfnOutput(this, 'CognitoDomain', {
      value: `https://rag-${props.stage}-${this.account}.auth.${this.region}.amazoncognito.com`,
      exportName: `rag-cognito-domain-${props.stage}`,
    });
  }
}
