import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import { Construct } from 'constructs';

interface FrontendStackProps extends cdk.StackProps {
  stage: string;
  ephemeral: boolean;
}

export class FrontendStack extends cdk.Stack {
  public readonly bucketName: string;
  public readonly distributionId: string;
  public readonly distributionUrl: string;

  constructor(scope: Construct, id: string, props: FrontendStackProps) {
    super(scope, id, props);

    const removalPolicy = props.ephemeral
      ? cdk.RemovalPolicy.DESTROY
      : cdk.RemovalPolicy.RETAIN;

    const siteBucket = new s3.Bucket(this, 'SiteBucket', {
      bucketName: `rag-ui-${props.stage}-${this.account}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy,
      autoDeleteObjects: props.ephemeral,
    });

    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      comment: `RAG UI - ${props.stage}`,
      defaultRootObject: 'index.html',

      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(siteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        // Immutable assets (hashed filenames from Vite) cached aggressively;
        // index.html is small and served fresh via a separate behaviour below.
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
        compress: true,
      },

      additionalBehaviors: {
        // index.html must never be cached - it controls which JS bundle is loaded
        '/index.html': {
          origin: origins.S3BucketOrigin.withOriginAccessControl(siteBucket),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
        },
        // Runtime config also uncached so environment updates take effect immediately
        '/config.json': {
          origin: origins.S3BucketOrigin.withOriginAccessControl(siteBucket),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
        },
      },

      // SPA routing: every unresolved path returns index.html so React Router works
      errorResponses: [
        { httpStatus: 403, responseHttpStatus: 200, responsePagePath: '/index.html', ttl: cdk.Duration.seconds(0) },
        { httpStatus: 404, responseHttpStatus: 200, responsePagePath: '/index.html', ttl: cdk.Duration.seconds(0) },
      ],

      // PRICE_CLASS_100 covers US + Europe - cheapest tier, ~40% cost reduction vs global
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
    });

    this.bucketName = siteBucket.bucketName;
    this.distributionId = distribution.distributionId;
    this.distributionUrl = `https://${distribution.distributionDomainName}`;

    new cdk.CfnOutput(this, 'SiteBucketName', {
      value: siteBucket.bucketName,
      exportName: `rag-ui-bucket-${props.stage}`,
    });
    new cdk.CfnOutput(this, 'DistributionUrl', {
      value: this.distributionUrl,
      exportName: `rag-ui-url-${props.stage}`,
    });
    new cdk.CfnOutput(this, 'DistributionId', {
      value: distribution.distributionId,
      exportName: `rag-ui-cf-id-${props.stage}`,
    });
  }
}
