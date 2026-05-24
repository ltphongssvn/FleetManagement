#!/bin/bash
# infra/localstack-init/01-create-bucket.sh
# Auto-creates the artifacts bucket when LocalStack S3 is ready so the API
# can presign uploads in Docker Compose end-to-end verification.
set -e
awslocal s3 mb s3://fleet-pilot-artifacts || true
awslocal s3api put-bucket-cors --bucket fleet-pilot-artifacts --cors-configuration '{
  "CORSRules": [{
    "AllowedHeaders": ["*"],
    "AllowedMethods": ["PUT", "GET", "HEAD"],
    "AllowedOrigins": ["*"],
    "ExposeHeaders": ["ETag"]
  }]
}' || true
echo "localstack-init: bucket fleet-pilot-artifacts ready"
