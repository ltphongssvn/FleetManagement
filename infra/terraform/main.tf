# infra/terraform/main.tf
# Pilot-scope infrastructure for FleetManagement v1.0.
# Provisions: Fly.io API app, Fly.io worker app, S3 artifact bucket.
# Deferred per PDF: cross-region replication, multi-AZ, Redis Streams adapter for Socket.IO.

provider "fly" {
  fly_api_token = var.fly_api_token
}

provider "aws" {
  region = var.aws_region
}

# ---------------------------------------------------------------------------
# Fly.io applications (API + single worker per PDF "Single worker deployment")
# ---------------------------------------------------------------------------
resource "fly_app" "api" {
  name = "${var.project_name}-api"
  org  = var.fly_org
}

resource "fly_app" "worker" {
  name = "${var.project_name}-worker"
  org  = var.fly_org
}

# ---------------------------------------------------------------------------
# S3 bucket for manifest artifacts + bootstrap snapshots (PDF "Uploads" section)
# ---------------------------------------------------------------------------
resource "random_id" "bucket_suffix" {
  byte_length = 4
}

resource "aws_s3_bucket" "artifacts" {
  bucket = "${var.project_name}-artifacts-${random_id.bucket_suffix.hex}"

  tags = {
    Project     = var.project_name
    Environment = "pilot"
    ManagedBy   = "terraform"
  }
}

resource "aws_s3_bucket_versioning" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "artifacts" {
  bucket                  = aws_s3_bucket.artifacts.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Lifecycle: PDF "S3 abort-incomplete lifecycle" + 60min bootstrap artifact rule
resource "aws_s3_bucket_lifecycle_configuration" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id

  rule {
    id     = "abort-incomplete-multipart"
    status = "Enabled"
    filter {}

    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }

  rule {
    id     = "expire-bootstrap-artifacts"
    status = "Enabled"
    filter {
      prefix = "bootstrap/"
    }

    expiration {
      days = 1
    }
  }
}

# ---------------------------------------------------------------------------
# Fly Postgres (managed) — pilot single-instance per PDF Day-One #10
# Per PDF: "Postgres (managed), Redis (for BullMQ), S3 bucket - Single region"
# ---------------------------------------------------------------------------
resource "fly_machine" "postgres" {
  app    = fly_app.api.name
  region = var.fly_region
  name   = "${var.project_name}-pg"
  image  = "flyio/postgres-flex:15"
  env = {
    PRIMARY_REGION = var.fly_region
  }
  services = [{
    ports = [{
      port     = 5432
      handlers = ["pg_tls"]
    }]
    protocol      = "tcp"
    internal_port = 5432
  }]
}

# ---------------------------------------------------------------------------
# Upstash Redis for BullMQ. Day-One: "Redis (for BullMQ)".
# Outputs REDIS_URL via outputs.tf for Fly app secret injection.
# ---------------------------------------------------------------------------
# NOTE: Upstash provider provisioning is a follow-up. For pilot day-one we
# document the manual creation step here so plan/apply does not silently skip
# the dependency. Operator runs `flyctl redis create` once, sets REDIS_URL
# via `flyctl secrets set` on both api + worker apps.
