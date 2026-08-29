import * as cdk from 'aws-cdk-lib';
import * as elasticache from 'aws-cdk-lib/aws-elasticache';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';
import { RagConfig } from '../config';

interface CacheStackProps extends cdk.StackProps {
  stage: string;
  vpc: ec2.Vpc;
  vpcCidr: string;
  privateSubnets: ec2.ISubnet[];
  config: RagConfig;
}

export class CacheStack extends cdk.Stack {
  public readonly replicationGroup: elasticache.CfnReplicationGroup;
  public readonly securityGroup: ec2.SecurityGroup;
  public readonly primaryEndpointAddress: string;
  public readonly primaryEndpointPort: string;

  constructor(scope: Construct, id: string, props: CacheStackProps) {
    super(scope, id, props);

    this.securityGroup = new ec2.SecurityGroup(this, 'CacheSg', {
      vpc: props.vpc,
      description: 'ElastiCache Redis - allow from within VPC only',
      allowAllOutbound: false,
    });
    // Allow Redis access from anywhere in the VPC (private/isolated subnets only by routing).
    this.securityGroup.addIngressRule(
      ec2.Peer.ipv4(props.vpcCidr),
      ec2.Port.tcp(6379),
      'Redis from VPC CIDR',
    );

    const subnetGroup = new elasticache.CfnSubnetGroup(this, 'CacheSubnetGroup', {
      description: `RAG Redis subnet group - ${props.stage}`,
      cacheSubnetGroupName: `rag-cache-subnets-${props.stage}`,
      subnetIds: props.privateSubnets.map((s) => s.subnetId),
    });

    const cfg = props.config.cache;

    this.replicationGroup = new elasticache.CfnReplicationGroup(this, 'RagCache', {
      replicationGroupId: `rag-cache-${props.stage}`,
      replicationGroupDescription: `RAG semantic + response cache - ${props.stage}`,
      engine: 'redis',
      engineVersion: '7.1',
      cacheNodeType: cfg.nodeType,
      // numCacheClusters = 1 primary + N replicas
      numCacheClusters: 1 + cfg.replicaCount,
      automaticFailoverEnabled: cfg.automaticFailover,
      multiAzEnabled: cfg.automaticFailover,
      atRestEncryptionEnabled: true,
      transitEncryptionEnabled: true,
      // AUTH token omitted - IAM auth via VPC security groups is sufficient for intra-VPC access
      cacheSubnetGroupName: subnetGroup.cacheSubnetGroupName,
      securityGroupIds: [this.securityGroup.securityGroupId],
      // Ephemeral stacks skip snapshots entirely - no point backing up throwaway data
      snapshotRetentionLimit: props.config.ephemeral ? 0 : (props.stage === 'prod' ? 7 : 1),
      // maxmemory-policy: allkeys-lru evicts least-recently-used when memory is full
      // suitable for a cache workload where all keys are acceptable to evict
      cacheParameterGroupName: this.createParamGroup(props.stage),
    });
    this.replicationGroup.addDependency(subnetGroup);

    this.primaryEndpointAddress = this.replicationGroup.attrPrimaryEndPointAddress;
    this.primaryEndpointPort = this.replicationGroup.attrPrimaryEndPointPort;

    new cdk.CfnOutput(this, 'CacheEndpoint', {
      value: this.replicationGroup.attrPrimaryEndPointAddress,
      exportName: `rag-cache-endpoint-${props.stage}`,
    });
    new cdk.CfnOutput(this, 'CachePort', {
      value: this.replicationGroup.attrPrimaryEndPointPort,
      exportName: `rag-cache-port-${props.stage}`,
    });
  }

  private createParamGroup(stage: string): string {
    const pg = new elasticache.CfnParameterGroup(this, 'CacheParamGroup', {
      cacheParameterGroupFamily: 'redis7',
      description: `RAG Redis params - ${stage}`,
      properties: {
        'maxmemory-policy': 'allkeys-lru',
        'activedefrag': 'yes',
      },
    });
    return pg.ref;
  }
}
