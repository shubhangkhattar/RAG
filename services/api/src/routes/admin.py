"""
Admin endpoints — restricted to users whose Cognito `custom:roles` contains "admin".

POST   /v1/admin/presigned-upload            Generate S3 presigned PUT URL for direct upload
GET    /v1/admin/ingestion-status            List documents and their indexing state
GET    /v1/admin/users                       List Cognito users
POST   /v1/admin/users                       Create user and send temp password
PUT    /v1/admin/users/{username}            Update namespace / roles
DELETE /v1/admin/users/{username}            Delete user
"""
import base64
import json
import os
from typing import Optional

import boto3
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, EmailStr

router = APIRouter(prefix="/v1/admin", tags=["admin"])

REGION = os.environ.get("AWS_DEFAULT_REGION", "us-east-1")
RAW_DOCS_BUCKET = os.environ.get("RAW_DOCS_BUCKET", "")
COGNITO_USER_POOL_ID = os.environ.get("COGNITO_USER_POOL_ID", "")
PRESIGNED_URL_EXPIRY = 900  # 15 minutes

s3 = boto3.client("s3", region_name=REGION)
cognito = boto3.client("cognito-idp", region_name=REGION)


# ── Auth dependency ───────────────────────────────────────────────────────────

def _admin_claims(request: Request) -> dict:
    """Decode JWT and enforce admin role."""
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")

    token = auth.removeprefix("Bearer ")
    try:
        payload_b64 = token.split(".")[1]
        padded = payload_b64 + "=" * (4 - len(payload_b64) % 4)
        claims = json.loads(base64.urlsafe_b64decode(padded))
    except Exception:
        raise HTTPException(status_code=401, detail="Malformed token")

    roles = claims.get("custom:roles", "")
    if "admin" not in [r.strip() for r in roles.split(",")]:
        raise HTTPException(status_code=403, detail="Admin role required")

    return claims


# ── Presigned upload ──────────────────────────────────────────────────────────

class PresignedUploadRequest(BaseModel):
    filename: str
    namespace: str
    content_type: str = "application/pdf"


class PresignedUploadResponse(BaseModel):
    upload_url: str
    s3_key: str


@router.post("/presigned-upload", response_model=PresignedUploadResponse)
def presigned_upload(
    body: PresignedUploadRequest,
    _: dict = Depends(_admin_claims),
):
    # Key convention: documents/<namespace>/<filename>
    # This matches the EventBridge rule prefix filter so ingestion triggers automatically.
    s3_key = f"documents/{body.namespace}/{body.filename}"

    url = s3.generate_presigned_url(
        "put_object",
        Params={
            "Bucket": RAW_DOCS_BUCKET,
            "Key": s3_key,
            "ContentType": body.content_type,
        },
        ExpiresIn=PRESIGNED_URL_EXPIRY,
    )
    return PresignedUploadResponse(upload_url=url, s3_key=s3_key)


# ── Ingestion status ──────────────────────────────────────────────────────────

class DocumentStatus(BaseModel):
    filename: str
    namespace: str
    s3_key: str
    size_bytes: int
    uploaded_at: str
    status: str  # "indexed" | "pending" | "processing"


@router.get("/ingestion-status", response_model=list[DocumentStatus])
def ingestion_status(
    namespace: Optional[str] = None,
    _: dict = Depends(_admin_claims),
):
    """
    Correlates raw-docs uploads against processed chunks to determine status.
    Status logic:
      - File in raw-docs AND chunk file exists in processed-docs → indexed
      - File in raw-docs AND no chunk file → pending / processing
    """
    prefix = f"documents/{namespace}/" if namespace else "documents/"

    raw_paginator = s3.get_paginator("list_objects_v2")
    raw_objects = []
    for page in raw_paginator.paginate(Bucket=RAW_DOCS_BUCKET, Prefix=prefix):
        raw_objects.extend(page.get("Contents", []))

    results = []
    for obj in raw_objects:
        key: str = obj["Key"]          # documents/<ns>/<filename>
        parts = key.split("/", 2)
        if len(parts) < 3:
            continue
        ns, filename = parts[1], parts[2]
        if not filename:
            continue

        import uuid as _uuid
        doc_id = str(_uuid.uuid5(_uuid.NAMESPACE_URL, f"s3://{RAW_DOCS_BUCKET}/{key}"))
        chunk_key = f"chunks/{ns}/{doc_id}.jsonl"

        try:
            s3.head_object(Bucket=RAW_DOCS_BUCKET, Key=chunk_key)
            status = "indexed"
        except s3.exceptions.ClientError:
            status = "pending"

        results.append(DocumentStatus(
            filename=filename,
            namespace=ns,
            s3_key=key,
            size_bytes=obj.get("Size", 0),
            uploaded_at=obj["LastModified"].isoformat(),
            status=status,
        ))

    return results


# ── User management ───────────────────────────────────────────────────────────

class UserOut(BaseModel):
    username: str
    email: str
    namespace: str
    roles: str
    enabled: bool
    status: str


class CreateUserRequest(BaseModel):
    email: str
    namespace: str
    roles: str = "user"
    temp_password: str


class UpdateUserRequest(BaseModel):
    namespace: Optional[str] = None
    roles: Optional[str] = None


def _parse_user(user: dict) -> UserOut:
    attrs = {a["Name"]: a["Value"] for a in user.get("Attributes", [])}
    return UserOut(
        username=user["Username"],
        email=attrs.get("email", ""),
        namespace=attrs.get("custom:namespace", ""),
        roles=attrs.get("custom:roles", ""),
        enabled=user.get("Enabled", True),
        status=user.get("UserStatus", ""),
    )


@router.get("/users", response_model=list[UserOut])
def list_users(_: dict = Depends(_admin_claims)):
    users = []
    pagination_token = None
    while True:
        kwargs = {"UserPoolId": COGNITO_USER_POOL_ID, "Limit": 60}
        if pagination_token:
            kwargs["PaginationToken"] = pagination_token
        resp = cognito.list_users(**kwargs)
        users.extend([_parse_user(u) for u in resp.get("Users", [])])
        pagination_token = resp.get("PaginationToken")
        if not pagination_token:
            break
    return users


@router.post("/users", response_model=UserOut, status_code=201)
def create_user(body: CreateUserRequest, _: dict = Depends(_admin_claims)):
    try:
        resp = cognito.admin_create_user(
            UserPoolId=COGNITO_USER_POOL_ID,
            Username=body.email,
            TemporaryPassword=body.temp_password,
            UserAttributes=[
                {"Name": "email", "Value": body.email},
                {"Name": "email_verified", "Value": "true"},
                {"Name": "custom:namespace", "Value": body.namespace},
                {"Name": "custom:roles", "Value": body.roles},
            ],
            MessageAction="SUPPRESS",  # don't send Cognito's default welcome email
        )
    except cognito.exceptions.UsernameExistsException:
        raise HTTPException(status_code=409, detail="User already exists")

    return _parse_user(resp["User"])


@router.put("/users/{username}", response_model=UserOut)
def update_user(username: str, body: UpdateUserRequest, _: dict = Depends(_admin_claims)):
    attrs = []
    if body.namespace is not None:
        attrs.append({"Name": "custom:namespace", "Value": body.namespace})
    if body.roles is not None:
        attrs.append({"Name": "custom:roles", "Value": body.roles})

    if not attrs:
        raise HTTPException(status_code=400, detail="No attributes to update")

    cognito.admin_update_user_attributes(
        UserPoolId=COGNITO_USER_POOL_ID,
        Username=username,
        UserAttributes=attrs,
    )
    resp = cognito.admin_get_user(UserPoolId=COGNITO_USER_POOL_ID, Username=username)
    return _parse_user({
        "Username": resp["Username"],
        "Attributes": resp["UserAttributes"],
        "Enabled": resp["Enabled"],
        "UserStatus": resp["UserStatus"],
    })


@router.delete("/users/{username}", status_code=204)
def delete_user(username: str, _: dict = Depends(_admin_claims)):
    try:
        cognito.admin_delete_user(UserPoolId=COGNITO_USER_POOL_ID, Username=username)
    except cognito.exceptions.UserNotFoundException:
        raise HTTPException(status_code=404, detail="User not found")
