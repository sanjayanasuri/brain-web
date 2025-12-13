aws_region          = "us-east-1"
project             = "brain-web"
env                 = "demo"

# Route53 hosted zone for sanjayanasuri.com
route53_zone_id     = "Z02260361P824FA6BWL1Y"

# Custom domains
api_domain_name     = "api-demo.sanjayanasuri.com"
frontend_domain_name = "demo.sanjayanasuri.com"

# Optional budget alerts (set your email if you want Budgets enabled)
# budget_email        = "you@example.com"
# budget_monthly_usd  = 50

# NOTE: Do NOT put neo4j_password here. Provide it via CLI (-var) or Terraform environment variables.


