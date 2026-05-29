# infra/terraform/versions.tf
# Terraform + provider version pinning for the FleetManagement pilot.
# Per Frozen Stack PDF: single env (pilot), Fly.io for API+worker, managed Postgres+Redis, S3.

terraform {
  required_version = ">= 1.14.0, < 2.0.0"

  required_providers {
    fly = {
      source  = "fly-apps/fly"
      version = "~> 0.0.23"
    }
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.70"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
}
