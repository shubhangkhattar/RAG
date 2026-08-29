"""
S3 → Step Functions trigger.

Receives an S3 ObjectCreated event, extracts the object key + metadata,
and starts one Step Functions Express execution per object.
"""
import json
import os
import urllib.parse
import boto3

sfn = boto3.client('stepfunctions')

STATE_MACHINE_ARN = os.environ['STATE_MACHINE_ARN']
STAGE = os.environ.get('STAGE', 'dev')


def handler(event: dict, context) -> dict:
    executions = []

    for record in event.get('Records', []):
        bucket = record['s3']['bucket']['name']
        key = urllib.parse.unquote_plus(record['s3']['object']['key'])
        size = record['s3']['object'].get('size', 0)

        # Derive namespace and permissions from S3 key prefix convention:
        # documents/<namespace>/<filename>
        parts = key.split('/', 2)
        namespace = parts[1] if len(parts) >= 3 else 'default'

        payload = {
            'bucket': bucket,
            'key': key,
            'size': size,
            'namespace': namespace,
            'stage': STAGE,
        }

        resp = sfn.start_execution(
            stateMachineArn=STATE_MACHINE_ARN,
            # Execution name must be unique per state machine; use the S3 key (sanitised)
            name=key.replace('/', '_').replace('.', '-')[:80],
            input=json.dumps(payload),
        )
        executions.append(resp['executionArn'])

    return {'started': executions}
