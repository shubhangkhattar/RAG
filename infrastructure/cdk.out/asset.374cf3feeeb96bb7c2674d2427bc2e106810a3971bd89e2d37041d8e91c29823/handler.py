"""
S3 → Step Functions trigger (via EventBridge).

Receives an EventBridge "Object Created" event from S3, extracts bucket/key,
and starts one Step Functions Express execution per object.

EventBridge event shape:
  {
    "source": "aws.s3",
    "detail-type": "Object Created",
    "detail": {
      "bucket": {"name": "..."},
      "object": {"key": "...", "size": 123}
    }
  }
"""
import json
import os
import urllib.parse
import boto3

sfn = boto3.client('stepfunctions')

STATE_MACHINE_ARN = os.environ['STATE_MACHINE_ARN']
STAGE = os.environ.get('STAGE', 'dev')


def handler(event: dict, context) -> dict:
    detail = event.get('detail', {})
    bucket = detail['bucket']['name']
    key = urllib.parse.unquote_plus(detail['object']['key'])
    size = detail['object'].get('size', 0)

    # Key convention: documents/<namespace>/<filename>
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
        name=key.replace('/', '_').replace('.', '-')[:80],
        input=json.dumps(payload),
    )
    return {'executionArn': resp['executionArn']}
