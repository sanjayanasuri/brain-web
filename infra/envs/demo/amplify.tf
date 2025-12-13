locals {
  enable_amplify = var.frontend_domain_name != "" && var.route53_zone_id != "" && var.frontend_repo_url != "" && var.github_oauth_token != ""
}

# Optional: manage Amplify app via Terraform (requires a GitHub OAuth token).
# If you don't want to pass a token to Terraform, create the Amplify app in the console and only use the domain name there.
resource "aws_amplify_app" "frontend" {
  count        = local.enable_amplify ? 1 : 0
  name         = "${var.project}-${var.env}-frontend"
  repository   = var.frontend_repo_url
  access_token = var.github_oauth_token

  enable_auto_branch_creation = false
  platform                   = "WEB"

  # Build spec comes from repo root amplify.yml (monorepo aware)
  environment_variables = {
    NEXT_PUBLIC_API_URL      = var.api_domain_name != "" ? "https://${var.api_domain_name}" : "http://${aws_lb.api.dns_name}"
    NEXT_PUBLIC_DEMO_MODE    = "true"
  }
}

resource "aws_amplify_branch" "frontend" {
  count       = local.enable_amplify ? 1 : 0
  app_id      = aws_amplify_app.frontend[0].id
  branch_name = var.frontend_branch
  framework   = "Next.js - SSR"
  stage       = "PRODUCTION"
}

resource "aws_amplify_domain_association" "frontend" {
  count       = local.enable_amplify ? 1 : 0
  app_id      = aws_amplify_app.frontend[0].id
  domain_name = var.frontend_domain_name

  sub_domain {
    branch_name = aws_amplify_branch.frontend[0].branch_name
    prefix      = "" # apex for demo.sanjayanasuri.com
  }
}

# DNS validation record for Amplify-managed cert (Route53)
resource "aws_route53_record" "amplify_cert_validation" {
  count   = local.enable_amplify ? 1 : 0
  zone_id = var.route53_zone_id

  name = trimsuffix(
    element(split(" ", aws_amplify_domain_association.frontend[0].certificate_verification_dns_record), 0),
    "."
  )
  type = element(split(" ", aws_amplify_domain_association.frontend[0].certificate_verification_dns_record), 1)
  ttl  = 300
  records = [
    trimsuffix(element(split(" ", aws_amplify_domain_association.frontend[0].certificate_verification_dns_record), 2), ".")
  ]
}


