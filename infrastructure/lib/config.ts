export interface RagConfig {
  // If true: all resources use DESTROY removal policy so `cdk destroy` is clean.
  // If false: retained resources (S3, DynamoDB, OpenSearch, KMS) survive destroy.
  ephemeral: boolean;

  // If true: skip all VPC interface endpoints. Traffic routes via NAT Gateway.
  // Saves ~$115/month at the cost of traffic leaving the AWS backbone.
  // Fine for test/dev; disable for prod.
  skipVpcEndpoints: boolean;

  opensearch: {
    instanceType: string;
    dataNodes: number;
    masterNodes?: number;
    masterInstanceType?: string;
    volumeGb: number;
    multiAz: boolean;
  };
  cache: {
    nodeType: string;
    replicaCount: number;
    automaticFailover: boolean;
  };
  api: {
    cpu: number;
    memoryMiB: number;
    desiredCount: number;
    maxCount: number;
  };
}

export const configs: Record<string, RagConfig> = {
  // ── test ────────────────────────────────────────────────────────────────────
  // Minimum cost. All resources destroyed cleanly with `cdk destroy`.
  // No VPC interface endpoints — NAT handles all outbound traffic.
  // Estimated cost: ~$19 for 5 days, ~$115/month if left running.
  test: {
    ephemeral: true,
    skipVpcEndpoints: true,
    opensearch: {
      instanceType: 't3.small.search',
      dataNodes: 1,
      volumeGb: 20,
      multiAz: false,
    },
    cache: {
      nodeType: 'cache.t3.micro',
      replicaCount: 0,
      automaticFailover: false,
    },
    api: {
      cpu: 256,
      memoryMiB: 512,
      desiredCount: 1,
      maxCount: 2,
    },
  },

  // ── dev ─────────────────────────────────────────────────────────────────────
  // Persistent dev environment. Resources retained on destroy.
  // Full VPC endpoint set for prod-like network posture.
  // Estimated cost: ~$240/month.
  dev: {
    ephemeral: false,
    skipVpcEndpoints: false,
    opensearch: {
      instanceType: 't3.small.search',
      dataNodes: 1,
      volumeGb: 20,
      multiAz: false,
    },
    cache: {
      nodeType: 'cache.t3.micro',
      replicaCount: 0,
      automaticFailover: false,
    },
    api: {
      cpu: 256,
      memoryMiB: 512,
      desiredCount: 1,
      maxCount: 2,
    },
  },

  // ── prod ────────────────────────────────────────────────────────────────────
  // Multi-AZ, retained, full observability. Estimated cost: ~$1,250/month.
  prod: {
    ephemeral: false,
    skipVpcEndpoints: false,
    opensearch: {
      instanceType: 'm6g.large.search',
      dataNodes: 3,
      masterNodes: 3,
      masterInstanceType: 'm6g.large.search',
      volumeGb: 100,
      multiAz: true,
    },
    cache: {
      nodeType: 'cache.r6g.large',
      replicaCount: 1,
      automaticFailover: true,
    },
    api: {
      cpu: 2048,
      memoryMiB: 4096,
      desiredCount: 2,
      maxCount: 20,
    },
  },
};
