import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as actions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import { Construct } from 'constructs';

interface ObservabilityStackProps extends cdk.StackProps {
  stage: string;
  alarmEmail?: string;
}

export class ObservabilityStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ObservabilityStackProps) {
    super(scope, id, props);

    // ── SNS alarm topic ───────────────────────────────────────────────────────
    const alarmTopic = new sns.Topic(this, 'AlarmTopic', {
      topicName: `rag-alarms-${props.stage}`,
      displayName: `RAG System Alarms - ${props.stage}`,
    });
    if (props.alarmEmail) {
      alarmTopic.addSubscription(new subscriptions.EmailSubscription(props.alarmEmail));
    }
    const alarmAction = new actions.SnsAction(alarmTopic);

    // ── Metric helpers ────────────────────────────────────────────────────────
    const stage = props.stage;

    const ecsMetric = (metricName: string, stat: string = 'Average') =>
      new cloudwatch.Metric({
        namespace: 'AWS/ECS',
        metricName,
        dimensionsMap: { ClusterName: `rag-cluster-${stage}`, ServiceName: `rag-api-${stage}` },
        statistic: stat,
        period: cdk.Duration.minutes(1),
      });

    const albMetric = (metricName: string, stat: string = 'Sum') =>
      new cloudwatch.Metric({
        namespace: 'AWS/ApplicationELB',
        metricName,
        // LoadBalancer dimension is the ALB ARN suffix - use a search metric instead
        statistic: stat,
        period: cdk.Duration.minutes(1),
      });

    const osMetric = (metricName: string, stat: string = 'Average') =>
      new cloudwatch.Metric({
        namespace: 'AWS/ES',
        metricName,
        dimensionsMap: { DomainName: `rag-search-${stage}`, ClientId: this.account },
        statistic: stat,
        period: cdk.Duration.minutes(1),
      });

    const cacheMetric = (metricName: string, stat: string = 'Average') =>
      new cloudwatch.Metric({
        namespace: 'AWS/ElastiCache',
        metricName,
        dimensionsMap: { ReplicationGroupId: `rag-cache-${stage}` },
        statistic: stat,
        period: cdk.Duration.minutes(1),
      });

    const lambdaMetric = (fnName: string, metricName: string, stat: string = 'Sum') =>
      new cloudwatch.Metric({
        namespace: 'AWS/Lambda',
        metricName,
        dimensionsMap: { FunctionName: fnName },
        statistic: stat,
        period: cdk.Duration.minutes(5),
      });

    // ── Alarms ────────────────────────────────────────────────────────────────

    const ecsCpuAlarm = new cloudwatch.Alarm(this, 'EcsCpuAlarm', {
      alarmName: `rag-ecs-cpu-high-${stage}`,
      alarmDescription: 'ECS task CPU above 80% - consider scaling',
      metric: ecsMetric('CPUUtilization'),
      threshold: 80,
      evaluationPeriods: 3,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    ecsCpuAlarm.addAlarmAction(alarmAction);
    ecsCpuAlarm.addOkAction(alarmAction);

    const ecsMemAlarm = new cloudwatch.Alarm(this, 'EcsMemAlarm', {
      alarmName: `rag-ecs-memory-high-${stage}`,
      alarmDescription: 'ECS task memory above 85%',
      metric: ecsMetric('MemoryUtilization'),
      threshold: 85,
      evaluationPeriods: 3,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    ecsMemAlarm.addAlarmAction(alarmAction);

    const osRedAlarm = new cloudwatch.Alarm(this, 'OpenSearchRedAlarm', {
      alarmName: `rag-opensearch-red-${stage}`,
      alarmDescription: 'OpenSearch cluster status is RED - data loss risk',
      metric: osMetric('ClusterStatus.red', 'Maximum'),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    osRedAlarm.addAlarmAction(alarmAction);

    const osYellowAlarm = new cloudwatch.Alarm(this, 'OpenSearchYellowAlarm', {
      alarmName: `rag-opensearch-yellow-${stage}`,
      alarmDescription: 'OpenSearch cluster status is YELLOW - replica shards unassigned',
      metric: osMetric('ClusterStatus.yellow', 'Maximum'),
      threshold: 1,
      evaluationPeriods: 3,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    osYellowAlarm.addAlarmAction(alarmAction);

    const osDiskAlarm = new cloudwatch.Alarm(this, 'OpenSearchDiskAlarm', {
      alarmName: `rag-opensearch-disk-${stage}`,
      alarmDescription: 'OpenSearch free storage below 20% - index writes may stop',
      metric: osMetric('FreeStorageSpace', 'Minimum'),
      // 20 GB volume × 20% = 4096 MB
      threshold: 4096,
      evaluationPeriods: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    osDiskAlarm.addAlarmAction(alarmAction);

    const lambdaErrorAlarm = new cloudwatch.Alarm(this, 'IngestionErrorAlarm', {
      alarmName: `rag-ingestion-errors-${stage}`,
      alarmDescription: 'Ingestion Lambda errors - documents may not be indexed',
      metric: new cloudwatch.MathExpression({
        expression: 'processorErrors + embedderErrors',
        usingMetrics: {
          processorErrors: lambdaMetric(`rag-processor-${stage}`, 'Errors'),
          embedderErrors: lambdaMetric(`rag-embedder-${stage}`, 'Errors'),
        },
        period: cdk.Duration.minutes(5),
      }),
      threshold: 3,
      evaluationPeriods: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    lambdaErrorAlarm.addAlarmAction(alarmAction);

    // ── Dashboard ─────────────────────────────────────────────────────────────
    new cloudwatch.Dashboard(this, 'RagDashboard', {
      dashboardName: `rag-system-${stage}`,
      widgets: [
        // Row 1: API health
        [
          new cloudwatch.GraphWidget({
            title: 'ECS - CPU & Memory Utilization',
            width: 12,
            left: [ecsMetric('CPUUtilization'), ecsMetric('MemoryUtilization')],
            leftAnnotations: [{ value: 80, label: 'CPU threshold', color: '#ff6961' }],
          }),
          new cloudwatch.GraphWidget({
            title: 'ECS - Running Task Count',
            width: 12,
            left: [ecsMetric('RunningTaskCount', 'Maximum')],
          }),
        ],

        // Row 2: OpenSearch
        [
          new cloudwatch.GraphWidget({
            title: 'OpenSearch - Search Latency (ms)',
            width: 8,
            left: [
              osMetric('SearchLatency', 'p50'),
              osMetric('SearchLatency', 'p99'),
            ],
          }),
          new cloudwatch.GraphWidget({
            title: 'OpenSearch - Indexing Rate',
            width: 8,
            left: [osMetric('IndexingRate', 'Average')],
          }),
          new cloudwatch.GraphWidget({
            title: 'OpenSearch - Free Storage (MB)',
            width: 8,
            left: [osMetric('FreeStorageSpace', 'Minimum')],
            leftAnnotations: [{ value: 4096, label: 'Low disk threshold', color: '#ff6961' }],
          }),
        ],

        // Row 3: Cache
        [
          new cloudwatch.GraphWidget({
            title: 'Redis - Cache Hits vs Misses',
            width: 12,
            left: [
              cacheMetric('CacheHits', 'Sum'),
              cacheMetric('CacheMisses', 'Sum'),
            ],
          }),
          new cloudwatch.GraphWidget({
            title: 'Redis - Connections & Memory',
            width: 12,
            left: [cacheMetric('CurrConnections', 'Maximum')],
            right: [cacheMetric('BytesUsedForCache', 'Maximum')],
          }),
        ],

        // Row 4: Ingestion pipeline
        [
          new cloudwatch.GraphWidget({
            title: 'Ingestion Lambdas - Invocations',
            width: 8,
            left: [
              lambdaMetric(`rag-processor-${stage}`, 'Invocations'),
              lambdaMetric(`rag-embedder-${stage}`, 'Invocations'),
            ],
          }),
          new cloudwatch.GraphWidget({
            title: 'Ingestion Lambdas - Errors',
            width: 8,
            left: [
              lambdaMetric(`rag-processor-${stage}`, 'Errors'),
              lambdaMetric(`rag-embedder-${stage}`, 'Errors'),
            ],
          }),
          new cloudwatch.GraphWidget({
            title: 'Ingestion Lambdas - Duration (ms)',
            width: 8,
            left: [
              lambdaMetric(`rag-processor-${stage}`, 'Duration', 'p99'),
              lambdaMetric(`rag-embedder-${stage}`, 'Duration', 'p99'),
            ],
          }),
        ],

        // Row 5: Alarm status overview
        [
          new cloudwatch.AlarmStatusWidget({
            title: 'Active Alarms',
            width: 24,
            alarms: [
              ecsCpuAlarm,
              ecsMemAlarm,
              osRedAlarm,
              osYellowAlarm,
              osDiskAlarm,
              lambdaErrorAlarm,
            ],
          }),
        ],
      ],
    });

    new cdk.CfnOutput(this, 'AlarmTopicArn', {
      value: alarmTopic.topicArn,
      exportName: `rag-alarm-topic-arn-${stage}`,
    });
  }
}
