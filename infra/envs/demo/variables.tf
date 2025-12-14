variable "aws_region" {
  type    = string
  default = "us-east-1"
}

variable "project" {
  type    = string
  default = "brain-web"
}

variable "env" {
  type    = string
  default = "demo"
}

variable "neo4j_uri" {
  type        = string
  description = "Neo4j Aura bolt/neo4j+s URI (stored in Secrets Manager in real deployments)."
  default     = ""
}

variable "neo4j_user" {
  type    = string
  default = "neo4j"
}

variable "neo4j_password" {
  type      = string
  sensitive = true
  default   = ""
}

variable "openai_api_key" {
  type        = string
  sensitive   = true
  description = "OpenAI API key for AI features (stored in Secrets Manager)."
  default     = ""
}

variable "desired_count" {
  type    = number
  default = 1
}

variable "container_cpu" {
  type    = number
  default = 512
}

variable "container_memory" {
  type    = number
  default = 1024
}

variable "waf_rate_limit_per_5m" {
  type    = number
  default = 2000
}

variable "budget_email" {
  type        = string
  description = "Email to notify for budget alarms."
  default     = ""
}

variable "budget_monthly_usd" {
  type    = number
  default = 50
}

variable "route53_zone_id" {
  type        = string
  description = "Optional: Route53 hosted zone ID (if you want TF to manage DNS)."
  default     = ""
}

variable "api_domain_name" {
  type        = string
  description = "Optional: custom domain for the backend API (e.g. api-demo.sanjayanasuri.com)."
  default     = ""
}

variable "frontend_domain_name" {
  type        = string
  description = "Custom domain for Amplify frontend (e.g. demo.sanjayanasuri.com)."
  default     = ""
}

variable "frontend_repo_url" {
  type        = string
  description = "GitHub repository URL for Amplify (optional; if empty, create Amplify app manually in console)."
  default     = ""
}

variable "frontend_branch" {
  type    = string
  default = "main"
}

variable "github_oauth_token" {
  type        = string
  sensitive   = true
  description = "Optional: GitHub OAuth token for Amplify to access the repo. Prefer creating the app in console if you don't want TF managing this."
  default     = ""
}


