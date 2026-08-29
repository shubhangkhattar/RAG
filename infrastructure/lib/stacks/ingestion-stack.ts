import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as events from 'aws-cdk-lib/aws-events';
import * as eventTargets from 'aws-cdk-lib/aws-events-targets';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as opensearch from 'aws-cdk-lib/aws-opensearchservice';
import * as path from 'path';
import { Construct } from 'constructs';

interface IngestionStackProps extends cdk.StackProps {
  stage: string;
  vpc: ec2.Vpc;
  privateSubnets: ec2.ISubnet[];
  rawDocsBucket: s3.Bucket;
  processedDocsBucket: s3.Bucket;
  openSearchDomain: opensearch.Domain;
  encryptionKey: kms.Key;
}

export class IngestionStack extends cdk.Stack {
  public readonly lambdaSecurityGroup: ec2.SecurityGroup;

  constructor(scope: Construct, id: string, props: IngestionStackProps) {
    super(scope, id, props);

    this.lambdaSecurityGroup = new ec2.SecurityGroup(this, 'IngestionLambdaSg', {
      vpc: props.vpc,
      description: 'Ingestion Lambdas - outbound to OpenSearch and AWS APIs',
      allowAllOutbound: true,
    });

    // Standard queue - EventBridge and Lambda DLQ targets do not support FIFO queues.
    const dlq = new sqs.Queue(this, 'IngestionDlq', {
      queueName: `rag-ingestion-dlq-${props.stage}`,
      encryptionMasterKey: props.encryptionKey,
      retentionPeriod: cdk.Duration.days(14),
    });

    // Shared least-privilege role for all ingestion Lambdas
    const lambdaRole = new iam.Role(this, 'IngestionLambdaRole', {
      roleName: `rag-ingestion-lambda-${props.stage}`,
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaVPCAccessExecutionRole'),
      ],
    });
    props.rawDocsBucket.grantRead(lambdaRole);
    props.processedDocsBucket.grantReadWrite(lambdaRole);
    props.encryptionKey.grantEncryptDecrypt(lambdaRole);

    lambdaRole.addToPolicy(new iam.PolicyStatement({
      sid: 'TextractAccess',
      actions: [
        'textract:StartDocumentAnalysis',
        'textract:GetDocumentAnalysis',
        'textract:AnalyzeDocument',
      ],
      resources: ['*'],
    }));
    lambdaRole.addToPolicy(new iam.PolicyStatement({
      sid: 'BedrockEmbeddings',
      actions: ['bedrock:InvokeModel'],
      // Titan Embeddings v2 for dense vectors
      resources: [`arn:aws:bedrock:${this.region}::foundation-model/amazon.titan-embed-text-v2:0`],
    }));
    lambdaRole.addToPolicy(new iam.PolicyStatement({
      sid: 'OpenSearchWrite',
      actions: ['es:ESHttpPost', 'es:ESHttpPut', 'es:ESHttpGet', 'es:ESHttpDelete'],
      resources: [`${props.openSearchDomain.domainArn}/*`],
    }));

    const commonEnv: Record<string, string> = {
      STAGE: props.stage,
      OPENSEARCH_ENDPOINT: props.openSearchDomain.domainEndpoint,
      PROCESSED_BUCKET: props.processedDocsBucket.bucketName,
      AWS_ACCOUNT_ID: this.account,
    };

    const lambdaDefaults = {
      runtime: lambda.Runtime.PYTHON_3_12,
      role: lambdaRole,
      vpc: props.vpc,
      vpcSubnets: { subnets: props.privateSubnets },
      securityGroups: [this.lambdaSecurityGroup],
      deadLetterQueue: dlq,
    };

    // Step 1: Extract text + chunk with hierarchy preservation via Textract
    const processorFn = new lambda.Function(this, 'ProcessorFn', {
      ...lambdaDefaults,
      functionName: `rag-processor-${props.stage}`,
      handler: 'handler.handler',
      code: lambda.Code.fromAsset(
        path.join(__dirname, '../../../services/ingestion/processor'),
      ),
      timeout: cdk.Duration.minutes(15),
      memorySize: 1024,
      environment: {
        ...commonEnv,
        RAW_BUCKET: props.rawDocsBucket.bucketName,
      },
      logRetention: logs.RetentionDays.ONE_MONTH,
    });

    // Step 2: Generate Titan embeddings and write to OpenSearch
    const embedderFn = new lambda.Function(this, 'EmbedderFn', {
      ...lambdaDefaults,
      functionName: `rag-embedder-${props.stage}`,
      handler: 'handler.handler',
      code: lambda.Code.fromAsset(
        path.join(__dirname, '../../../services/ingestion/embedder'),
      ),
      timeout: cdk.Duration.minutes(15),
      memorySize: 512,
      environment: commonEnv,
      logRetention: logs.RetentionDays.ONE_MONTH,
    });

    // Step Functions Express workflow - synchronous, sub-minute max, low cost
    const processStep = new tasks.LambdaInvoke(this, 'ProcessDocument', {
      lambdaFunction: processorFn,
      outputPath: '$.Payload',
      retryOnServiceExceptions: true,
    }).addRetry({
      maxAttempts: 2,
      backoffRate: 2,
      interval: cdk.Duration.seconds(5),
      errors: ['States.TaskFailed'],
    });

    const embedStep = new tasks.LambdaInvoke(this, 'EmbedAndIndex', {
      lambdaFunction: embedderFn,
      outputPath: '$.Payload',
      retryOnServiceExceptions: true,
    }).addRetry({
      maxAttempts: 3,
      backoffRate: 2,
      interval: cdk.Duration.seconds(10),
      errors: ['States.TaskFailed'],
    });

    const sfnLogGroup = new logs.LogGroup(this, 'IngestionSfnLogs', {
      logGroupName: `/rag/ingestion-sfn/${props.stage}`,
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const stateMachine = new sfn.StateMachine(this, 'IngestionStateMachine', {
      stateMachineName: `rag-ingestion-${props.stage}`,
      definitionBody: sfn.DefinitionBody.fromChainable(processStep.next(embedStep)),
      stateMachineType: sfn.StateMachineType.EXPRESS,
      tracingEnabled: true,
      logs: {
        destination: sfnLogGroup,
        level: sfn.LogLevel.ALL,
        includeExecutionData: true,
      },
    });

    // Thin trigger Lambda: receives S3 event and starts the state machine
    const triggerFn = new lambda.Function(this, 'TriggerFn', {
      functionName: `rag-ingestion-trigger-${props.stage}`,
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'handler.handler',
      code: lambda.Code.fromAsset(
        path.join(__dirname, '../../../services/ingestion/trigger'),
      ),
      timeout: cdk.Duration.seconds(30),
      memorySize: 128,
      environment: {
        STATE_MACHINE_ARN: stateMachine.stateMachineArn,
        STAGE: props.stage,
      },
      logRetention: logs.RetentionDays.ONE_MONTH,
    });
    stateMachine.grantStartExecution(triggerFn);

    // EventBridge rule: S3 ObjectCreated under documents/ → TriggerFn
    // Using EventBridge (instead of S3 addEventNotification) avoids a cross-stack
    // back-reference cycle: StorageStack → IngestionStack → StorageStack.
    const docUploadRule = new events.Rule(this, 'DocUploadRule', {
      ruleName: `rag-doc-upload-${props.stage}`,
      eventPattern: {
        source: ['aws.s3'],
        detailType: ['Object Created'],
        detail: {
          bucket: { name: [props.rawDocsBucket.bucketName] },
          object: { key: [{ prefix: 'documents/' }] },
        },
      },
    });
    docUploadRule.addTarget(
      new eventTargets.LambdaFunction(triggerFn, {
        deadLetterQueue: dlq,
        retryAttempts: 2,
      }),
    );

    new cdk.CfnOutput(this, 'StateMachineArn', {
      value: stateMachine.stateMachineArn,
      exportName: `rag-ingestion-sfn-arn-${props.stage}`,
    });
  }
}
