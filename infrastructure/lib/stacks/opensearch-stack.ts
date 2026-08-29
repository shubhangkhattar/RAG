import * as cdk from 'aws-cdk-lib';
import * as opensearch from 'aws-cdk-lib/aws-opensearchservice';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import { RagConfig } from '../config';

interface OpenSearchStackProps extends cdk.StackProps {
  stage: string;
  vpc: ec2.Vpc;
  vpcCidr: string;
  isolatedSubnets: ec2.ISubnet[];
  config: RagConfig;
}

export class OpenSearchStack extends cdk.Stack {
  public readonly domain: opensearch.Domain;
  public readonly domainSecurityGroup: ec2.SecurityGroup;

  constructor(scope: Construct, id: string, props: OpenSearchStackProps) {
    super(scope, id, props);

    this.domainSecurityGroup = new ec2.SecurityGroup(this, 'OpenSearchSg', {
      vpc: props.vpc,
      description: 'OpenSearch domain - allow HTTPS from within VPC only',
      allowAllOutbound: false,
    });
    // Allow any resource in the VPC to reach OpenSearch on 443.
    // Fine-grained IAM access control is the primary authorization layer;
    // SG rules provide defence-in-depth at the network layer.
    this.domainSecurityGroup.addIngressRule(
      ec2.Peer.ipv4(props.vpcCidr),
      ec2.Port.tcp(443),
      'HTTPS from VPC CIDR',
    );

    const slowLogGroup = new logs.LogGroup(this, 'OsSlowSearchLogs', {
      logGroupName: `/rag/opensearch/slow-search/${props.stage}`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    const appLogGroup = new logs.LogGroup(this, 'OsAppLogs', {
      logGroupName: `/rag/opensearch/app/${props.stage}`,
      retention: logs.RetentionDays.TWO_WEEKS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const cfg = props.config.opensearch;

    this.domain = new opensearch.Domain(this, 'RagOpenSearch', {
      domainName: `rag-search-${props.stage}`,
      version: opensearch.EngineVersion.OPENSEARCH_2_13,

      capacity: {
        dataNodeInstanceType: cfg.instanceType,
        dataNodes: cfg.dataNodes,
        ...(cfg.masterNodes && {
          masterNodes: cfg.masterNodes,
          masterNodeInstanceType: cfg.masterInstanceType,
        }),
      },

      ebs: {
        volumeSize: cfg.volumeGb,
        volumeType: ec2.EbsDeviceVolumeType.GP3,
        throughput: 250,
        iops: 3000,
      },

      zoneAwareness: cfg.multiAz
        ? { enabled: true, availabilityZoneCount: 2 }
        : { enabled: false },

      vpc: props.vpc,
      // One subnet per AZ; slice matches dataNodes count
      vpcSubnets: [{ subnets: props.isolatedSubnets.slice(0, cfg.dataNodes > 1 ? 2 : 1) }],
      securityGroups: [this.domainSecurityGroup],

      encryptionAtRest: { enabled: true },
      nodeToNodeEncryption: true,
      enforceHttps: true,
      tlsSecurityPolicy: opensearch.TLSSecurityPolicy.TLS_1_2,

      // Fine-grained access control lets us map IAM roles to OpenSearch roles
      // so the API task role and ingestion role get least-privilege index access
      fineGrainedAccessControl: {
        masterUserArn: `arn:aws:iam::${this.account}:root`,
      },

      logging: {
        slowSearchLogEnabled: true,
        slowSearchLogGroup: slowLogGroup,
        appLogEnabled: true,
        appLogGroup: appLogGroup,
        slowIndexLogEnabled: true,
      },

      removalPolicy: props.config.ephemeral ? cdk.RemovalPolicy.DESTROY : cdk.RemovalPolicy.RETAIN,
    });

    // Grant CloudWatch Logs permission to receive OpenSearch log publications
    const logPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      principals: [new iam.ServicePrincipal('es.amazonaws.com')],
      actions: ['logs:PutLogEvents', 'logs:CreateLogStream'],
      resources: [slowLogGroup.logGroupArn, appLogGroup.logGroupArn],
    });
    new logs.ResourcePolicy(this, 'OsLogResourcePolicy', {
      policyStatements: [logPolicy],
    });

    new cdk.CfnOutput(this, 'OpenSearchEndpoint', {
      value: this.domain.domainEndpoint,
      exportName: `rag-opensearch-endpoint-${props.stage}`,
    });
    new cdk.CfnOutput(this, 'OpenSearchDomainArn', {
      value: this.domain.domainArn,
      exportName: `rag-opensearch-arn-${props.stage}`,
    });
  }
}
