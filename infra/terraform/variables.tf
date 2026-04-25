# infra/terraform/variables.tf
# Input variables for the pilot environment. Real values supplied via terraform.tfvars
# (gitignored) or CI secrets. No defaults for sensitive fields — fail fast if missing.

variable "fly_api_token" {
  description = "Fly.io API token for provisioning apps. Source: https://fly.io/user/personal_access_tokens"
  type        = string
  sensitive   = true
}

variable "fly_org" {
  description = "Fly.io organization slug that owns the pilot apps."
  type        = string
}

variable "fly_region" {
  description = "Primary Fly.io region for pilot deployment (single region per PDF day-one plan)."
  type        = string
  default     = "sjc"
}

variable "aws_region" {
  description = "AWS region for S3 artifact bucket. Cross-region replication deferred until scale."
  type        = string
  default     = "us-west-2"
}

variable "project_name" {
  description = "Project identifier used as prefix for all resources."
  type        = string
  default     = "fleet-pilot"
}

variable "postgres_volume_size_gb" {
  description = "Fly Postgres volume size in GB. Pilot scope: 5 trucks, 1 depot."
  type        = number
  default     = 10
}

variable "redis_max_memory_mb" {
  description = "Upstash Redis max memory in MB for BullMQ job queues."
  type        = number
  default     = 256
}
