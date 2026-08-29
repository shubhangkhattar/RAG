"""
Shared OpenSearch client with AWS SigV4 auth.

Connection is reused across requests within a single container lifetime.
"""
import os
import boto3
from opensearchpy import OpenSearch, RequestsHttpConnection, AWSV4SignerAuth

_client = None


def get_opensearch() -> OpenSearch:
    global _client
    if _client is None:
        region = os.environ.get("AWS_DEFAULT_REGION", "us-east-1")
        endpoint = os.environ["OPENSEARCH_ENDPOINT"]
        credentials = boto3.Session().get_credentials()
        auth = AWSV4SignerAuth(credentials, region, "es")

        _client = OpenSearch(
            hosts=[{"host": endpoint, "port": 443}],
            http_auth=auth,
            use_ssl=True,
            verify_certs=True,
            connection_class=RequestsHttpConnection,
            timeout=30,
            max_retries=3,
            retry_on_timeout=True,
        )
    return _client
