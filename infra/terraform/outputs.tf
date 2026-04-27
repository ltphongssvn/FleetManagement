# infra/terraform/outputs.tf
# Exported values consumed by application config (Fly secrets, EAS env, etc).

output "api_app_name" {
  description = "Fly.io API application name."
  value       = fly_app.api.name
}

output "worker_app_name" {
  description = "Fly.io worker application name."
  value       = fly_app.worker.name
}

output "s3_artifacts_bucket" {
  description = "S3 bucket name for manifests and bootstrap artifacts."
  value       = aws_s3_bucket.artifacts.id
}

output "s3_artifacts_arn" {
  description = "S3 bucket ARN for IAM policy attachment."
  value       = aws_s3_bucket.artifacts.arn
}
