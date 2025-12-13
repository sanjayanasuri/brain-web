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


