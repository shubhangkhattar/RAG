import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';

interface NetworkStackProps extends cdk.StackProps {
  stage: string;
  // When true, all VPC interface endpoints are omitted and traffic routes via NAT.
  // Saves ~$115/month; appropriate for test/ephemeral stacks.
  skipVpcEndpoints?: boolean;
}

export class NetworkStack extends cdk.Stack {
  public readonly vpc: ec2.Vpc;
  public readonly vpcCidr: string;
  public readonly publicSubnets: ec2.ISubnet[];
  public readonly privateSubnets: ec2.ISubnet[];
  public readonly isolatedSubnets: ec2.ISubnet[];

  // Explicit CIDR avoids a CDK context lookup (AWS API call) when vpc.vpcCidrBlock
  // is referenced across stacks — which would fail without credentials at synth.
  private static readonly VPC_CIDR = '10.10.0.0/16';

  constructor(scope: Construct, id: string, props: NetworkStackProps) {
    super(scope, id, props);

    this.vpcCidr = NetworkStack.VPC_CIDR;

    this.vpc = new ec2.Vpc(this, 'RagVpc', {
      vpcName: `rag-vpc-${props.stage}`,
      ipAddresses: ec2.IpAddresses.cidr(NetworkStack.VPC_CIDR),
      maxAzs: 2,
      natGateways: 1,
      subnetConfiguration: [
        {
          name: 'public',
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
        },
        {
          name: 'private',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
          cidrMask: 24,
        },
        {
          name: 'isolated',
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
          cidrMask: 24,
        },
      ],
    });

    // Gateway endpoints — no NAT cost, no bandwidth charge
    this.vpc.addGatewayEndpoint('S3Endpoint', {
      service: ec2.GatewayVpcEndpointAwsService.S3,
    });
    this.vpc.addGatewayEndpoint('DynamoDBEndpoint', {
      service: ec2.GatewayVpcEndpointAwsService.DYNAMODB,
    });

    // Interface endpoints keep traffic on the AWS backbone and remove NAT dependency.
    // Skipped for ephemeral stacks (test) to save ~$115/month — NAT handles it instead.
    if (!props.skipVpcEndpoints) {
      this.vpc.addInterfaceEndpoint('BedrockRuntimeEndpoint', {
        service: ec2.InterfaceVpcEndpointAwsService.BEDROCK_RUNTIME,
        privateDnsEnabled: true,
      });
      this.vpc.addInterfaceEndpoint('TextractEndpoint', {
        service: ec2.InterfaceVpcEndpointAwsService.TEXTRACT,
        privateDnsEnabled: true,
      });
      this.vpc.addInterfaceEndpoint('EcrApiEndpoint', {
        service: ec2.InterfaceVpcEndpointAwsService.ECR,
        privateDnsEnabled: true,
      });
      this.vpc.addInterfaceEndpoint('EcrDkrEndpoint', {
        service: ec2.InterfaceVpcEndpointAwsService.ECR_DOCKER,
        privateDnsEnabled: true,
      });
      this.vpc.addInterfaceEndpoint('CloudWatchLogsEndpoint', {
        service: ec2.InterfaceVpcEndpointAwsService.CLOUDWATCH_LOGS,
        privateDnsEnabled: true,
      });
      this.vpc.addInterfaceEndpoint('StepFunctionsEndpoint', {
        service: ec2.InterfaceVpcEndpointAwsService.STEP_FUNCTIONS,
        privateDnsEnabled: true,
      });
      this.vpc.addInterfaceEndpoint('SsmEndpoint', {
        service: ec2.InterfaceVpcEndpointAwsService.SSM,
        privateDnsEnabled: true,
      });
      this.vpc.addInterfaceEndpoint('SecretsManagerEndpoint', {
        service: ec2.InterfaceVpcEndpointAwsService.SECRETS_MANAGER,
        privateDnsEnabled: true,
      });
    }

    const flowLogGroup = new logs.LogGroup(this, 'VpcFlowLogGroup', {
      logGroupName: `/rag/vpc-flow-logs/${props.stage}`,
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    new ec2.FlowLog(this, 'VpcFlowLog', {
      resourceType: ec2.FlowLogResourceType.fromVpc(this.vpc),
      destination: ec2.FlowLogDestination.toCloudWatchLogs(flowLogGroup),
    });

    this.publicSubnets = this.vpc.publicSubnets;
    this.privateSubnets = this.vpc.privateSubnets;
    this.isolatedSubnets = this.vpc.isolatedSubnets;

    new cdk.CfnOutput(this, 'VpcId', {
      value: this.vpc.vpcId,
      exportName: `rag-vpc-id-${props.stage}`,
    });
  }
}
