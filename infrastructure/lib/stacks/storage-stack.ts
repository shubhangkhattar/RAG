import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as kms from 'aws-cdk-lib/aws-kms';
import { Construct } from 'constructs';

interface StorageStackProps extends cdk.StackProps {
  stage: string;
  ephemeral: boolean;
}

export class StorageStack extends cdk.Stack {
  public readonly rawDocsBucket: s3.Bucket;
  public readonly processedDocsBucket: s3.Bucket;
  public readonly sessionsTable: dynamodb.Table;
  public readonly encryptionKey: kms.Key;

  constructor(scope: Construct, id: string, props: StorageStackProps) {
    super(scope, id, props);

    const removalPolicy = props.ephemeral ? cdk.RemovalPolicy.DESTROY : cdk.RemovalPolicy.RETAIN;

    this.encryptionKey = new kms.Key(this, 'RagKmsKey', {
      alias: `alias/rag-${props.stage}`,
      enableKeyRotation: true,
      description: 'RAG system - shared encryption key',
      removalPolicy,
    });

    const bucketDefaults: Partial<s3.BucketProps> = {
      encryptionKey: this.encryptionKey,
      encryption: s3.BucketEncryption.KMS,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      versioned: !props.ephemeral,   // versioning costs money; skip for ephemeral
      removalPolicy,
      // autoDeleteObjects lets CDK empty the bucket before deleting it on cdk destroy.
      // Only meaningful when removalPolicy is DESTROY.
      autoDeleteObjects: props.ephemeral,
    };

    this.rawDocsBucket = new s3.Bucket(this, 'RawDocsBucket', {
      ...bucketDefaults,
      bucketName: `rag-raw-docs-${props.stage}-${this.account}`,
      // EventBridge lets IngestionStack own the rule without a back-reference to this stack
      eventBridgeEnabled: true,
      lifecycleRules: props.ephemeral ? [] : [
        {
          transitions: [
            {
              storageClass: s3.StorageClass.INFREQUENT_ACCESS,
              transitionAfter: cdk.Duration.days(90),
            },
            {
              storageClass: s3.StorageClass.GLACIER,
              transitionAfter: cdk.Duration.days(365),
            },
          ],
        },
      ],
    });

    this.processedDocsBucket = new s3.Bucket(this, 'ProcessedDocsBucket', {
      ...bucketDefaults,
      bucketName: `rag-processed-docs-${props.stage}-${this.account}`,
    });

    // Sessions table: PK = session_id, SK = created_at (ISO8601 for range queries)
    this.sessionsTable = new dynamodb.Table(this, 'SessionsTable', {
      tableName: `rag-sessions-${props.stage}`,
      partitionKey: { name: 'session_id', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'created_at', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: this.encryptionKey,
      timeToLiveAttribute: 'ttl',
      // PITR adds cost; skip for ephemeral stacks where data loss is acceptable
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: !props.ephemeral },
      removalPolicy,
    });

    // Allows listing a user's active sessions across all session IDs
    this.sessionsTable.addGlobalSecondaryIndex({
      indexName: 'user-sessions-index',
      partitionKey: { name: 'user_id', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'created_at', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.INCLUDE,
      nonKeyAttributes: ['session_name', 'namespace', 'message_count'],
    });

    new cdk.CfnOutput(this, 'RawDocsBucketName', {
      value: this.rawDocsBucket.bucketName,
      exportName: `rag-raw-docs-bucket-${props.stage}`,
    });
    new cdk.CfnOutput(this, 'SessionsTableName', {
      value: this.sessionsTable.tableName,
      exportName: `rag-sessions-table-${props.stage}`,
    });
    new cdk.CfnOutput(this, 'KmsKeyArn', {
      value: this.encryptionKey.keyArn,
      exportName: `rag-kms-key-arn-${props.stage}`,
    });
  }
}
