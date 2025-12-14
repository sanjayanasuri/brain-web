output "ecr_repository_url" {
  value = aws_ecr_repository.api.repository_url
}

output "alb_dns_name" {
  value = aws_lb.api.dns_name
}

output "api_domain" {
  value = var.api_domain_name
}

output "frontend_domain" {
  value = var.frontend_domain_name
}

output "events_table_name" {
  value = aws_dynamodb_table.events.name
}

output "neo4j_secret_arn" {
  value = aws_secretsmanager_secret.neo4j.arn
}

output "amplify_app_id" {
  value       = local.enable_amplify ? aws_amplify_app.frontend[0].id : null
  description = "Amplify app ID for reference"
}

output "amplify_app_default_domain" {
  value       = local.enable_amplify ? aws_amplify_app.frontend[0].default_domain : null
  description = "Amplify app default domain"
}

output "amplify_branch_domain" {
  value = local.enable_amplify ? "${aws_amplify_branch.frontend[0].branch_name}.${aws_amplify_app.frontend[0].id}.amplifyapp.com" : null
  description = "Amplify branch domain (CNAME target for www subdomain)"
}


