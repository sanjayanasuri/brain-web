locals {
  name = "${var.project}-${var.env}"
}

data "aws_caller_identity" "current" {}
data "aws_availability_zones" "available" {
  state = "available"
}

# -----------------------------------------------------------------------------
# Networking (minimal, 2 AZs, 1 NAT for cost control)
# -----------------------------------------------------------------------------
resource "aws_vpc" "main" {
  cidr_block           = "10.50.0.0/16"
  enable_dns_hostnames = true
  enable_dns_support   = true
  tags = { Name = "${local.name}-vpc" }
}

resource "aws_internet_gateway" "igw" {
  vpc_id = aws_vpc.main.id
  tags   = { Name = "${local.name}-igw" }
}

resource "aws_subnet" "public_a" {
  vpc_id                  = aws_vpc.main.id
  cidr_block              = "10.50.0.0/20"
  availability_zone       = data.aws_availability_zones.available.names[0]
  map_public_ip_on_launch = true
  tags = { Name = "${local.name}-public-a" }
}

resource "aws_subnet" "public_b" {
  vpc_id                  = aws_vpc.main.id
  cidr_block              = "10.50.16.0/20"
  availability_zone       = data.aws_availability_zones.available.names[1]
  map_public_ip_on_launch = true
  tags = { Name = "${local.name}-public-b" }
}

resource "aws_subnet" "private_a" {
  vpc_id            = aws_vpc.main.id
  cidr_block        = "10.50.128.0/20"
  availability_zone = data.aws_availability_zones.available.names[0]
  tags              = { Name = "${local.name}-private-a" }
}

resource "aws_subnet" "private_b" {
  vpc_id            = aws_vpc.main.id
  cidr_block        = "10.50.144.0/20"
  availability_zone = data.aws_availability_zones.available.names[1]
  tags              = { Name = "${local.name}-private-b" }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id
  tags   = { Name = "${local.name}-rt-public" }
}

resource "aws_route" "public_default" {
  route_table_id         = aws_route_table.public.id
  destination_cidr_block = "0.0.0.0/0"
  gateway_id             = aws_internet_gateway.igw.id
}

resource "aws_route_table_association" "public_a" {
  route_table_id = aws_route_table.public.id
  subnet_id      = aws_subnet.public_a.id
}

resource "aws_route_table_association" "public_b" {
  route_table_id = aws_route_table.public.id
  subnet_id      = aws_subnet.public_b.id
}

resource "aws_eip" "nat" {
  domain = "vpc"
  tags   = { Name = "${local.name}-nat-eip" }
}

resource "aws_nat_gateway" "nat" {
  allocation_id = aws_eip.nat.id
  subnet_id     = aws_subnet.public_a.id
  tags          = { Name = "${local.name}-nat" }
  depends_on    = [aws_internet_gateway.igw]
}

resource "aws_route_table" "private" {
  vpc_id = aws_vpc.main.id
  tags   = { Name = "${local.name}-rt-private" }
}

resource "aws_route" "private_default" {
  route_table_id         = aws_route_table.private.id
  destination_cidr_block = "0.0.0.0/0"
  nat_gateway_id         = aws_nat_gateway.nat.id
}

resource "aws_route_table_association" "private_a" {
  route_table_id = aws_route_table.private.id
  subnet_id      = aws_subnet.private_a.id
}

resource "aws_route_table_association" "private_b" {
  route_table_id = aws_route_table.private.id
  subnet_id      = aws_subnet.private_b.id
}

# -----------------------------------------------------------------------------
# ECR (backend image)
# -----------------------------------------------------------------------------
resource "aws_ecr_repository" "api" {
  name                 = "${local.name}-api"
  image_tag_mutability = "MUTABLE"
  image_scanning_configuration { scan_on_push = true }
}

resource "aws_ecr_lifecycle_policy" "api" {
  repository = aws_ecr_repository.api.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep last 30 images"
      selection    = { tagStatus = "any", countType = "imageCountMoreThan", countNumber = 30 }
      action       = { type = "expire" }
    }]
  })
}

# -----------------------------------------------------------------------------
# Secrets (demo: can be set via TF vars; upgrade path: set in Secrets Manager out-of-band)
# -----------------------------------------------------------------------------
resource "aws_secretsmanager_secret" "neo4j" {
  name = "${local.name}/neo4j"
}

resource "aws_secretsmanager_secret_version" "neo4j" {
  secret_id     = aws_secretsmanager_secret.neo4j.id
  secret_string = jsonencode({ uri = var.neo4j_uri, user = var.neo4j_user, password = var.neo4j_password })
}

# -----------------------------------------------------------------------------
# CloudWatch Logs
# -----------------------------------------------------------------------------
resource "aws_cloudwatch_log_group" "api" {
  name              = "/ecs/${local.name}-api"
  retention_in_days = 14
}

# -----------------------------------------------------------------------------
# DynamoDB (anonymous product events)
# -----------------------------------------------------------------------------
resource "aws_dynamodb_table" "events" {
  name         = "${local.name}-events"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk"
  range_key    = "sk"
  attribute { name = "pk", type = "S" }
  attribute { name = "sk", type = "S" }
  point_in_time_recovery { enabled = true }
}

# -----------------------------------------------------------------------------
# Security Groups
# -----------------------------------------------------------------------------
resource "aws_security_group" "alb" {
  name        = "${local.name}-alb-sg"
  vpc_id      = aws_vpc.main.id
  description = "ALB ingress"
  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_security_group" "api" {
  name        = "${local.name}-api-sg"
  vpc_id      = aws_vpc.main.id
  description = "ECS tasks"
  ingress {
    from_port       = 8000
    to_port         = 8000
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

# -----------------------------------------------------------------------------
# ALB
# -----------------------------------------------------------------------------
resource "aws_lb" "api" {
  name               = "${local.name}-alb"
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = [aws_subnet.public_a.id, aws_subnet.public_b.id]
}

resource "aws_lb_target_group" "api" {
  name        = "${local.name}-tg"
  port        = 8000
  protocol    = "HTTP"
  vpc_id      = aws_vpc.main.id
  target_type = "ip"
  health_check {
    path                = "/"
    healthy_threshold   = 2
    unhealthy_threshold = 3
    interval            = 30
    timeout             = 5
    matcher             = "200-399"
  }
}

resource "aws_lb_listener" "http_forward" {
  count             = var.api_domain_name != "" && var.route53_zone_id != "" ? 0 : 1
  load_balancer_arn = aws_lb.api.arn
  port              = 80
  protocol          = "HTTP"
  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api.arn
  }
}

resource "aws_lb_listener" "http_redirect" {
  count             = var.api_domain_name != "" && var.route53_zone_id != "" ? 1 : 0
  load_balancer_arn = aws_lb.api.arn
  port              = 80
  protocol          = "HTTP"
  default_action {
    type = "redirect"
    redirect {
      host        = "#{host}"
      path        = "/#{path}"
      port        = "443"
      protocol    = "HTTPS"
      query       = "#{query}"
      status_code = "HTTP_301"
    }
  }
}

# Optional TLS + custom domain
resource "aws_acm_certificate" "api" {
  count             = var.api_domain_name != "" && var.route53_zone_id != "" ? 1 : 0
  domain_name       = var.api_domain_name
  validation_method = "DNS"
  lifecycle { create_before_destroy = true }
}

resource "aws_route53_record" "api_cert_validation" {
  count   = var.api_domain_name != "" && var.route53_zone_id != "" ? 1 : 0
  zone_id = var.route53_zone_id
  name    = aws_acm_certificate.api[0].domain_validation_options[0].resource_record_name
  type    = aws_acm_certificate.api[0].domain_validation_options[0].resource_record_type
  records = [aws_acm_certificate.api[0].domain_validation_options[0].resource_record_value]
  ttl     = 60
}

resource "aws_acm_certificate_validation" "api" {
  count                   = var.api_domain_name != "" && var.route53_zone_id != "" ? 1 : 0
  certificate_arn         = aws_acm_certificate.api[0].arn
  validation_record_fqdns = [aws_route53_record.api_cert_validation[0].fqdn]
}

resource "aws_lb_listener" "https" {
  count             = var.api_domain_name != "" && var.route53_zone_id != "" ? 1 : 0
  load_balancer_arn = aws_lb.api.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = aws_acm_certificate_validation.api[0].certificate_arn
  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api.arn
  }
}

resource "aws_route53_record" "api_alias" {
  count   = var.api_domain_name != "" && var.route53_zone_id != "" ? 1 : 0
  zone_id = var.route53_zone_id
  name    = var.api_domain_name
  type    = "A"
  alias {
    name                   = aws_lb.api.dns_name
    zone_id                = aws_lb.api.zone_id
    evaluate_target_health = true
  }
}

# -----------------------------------------------------------------------------
# WAFv2 (basic bot protection + rate limiting)
# -----------------------------------------------------------------------------
resource "aws_wafv2_web_acl" "api" {
  name  = "${local.name}-waf"
  scope = "REGIONAL"

  default_action { allow {} }

  rule {
    name     = "AWSManagedRulesCommonRuleSet"
    priority = 1
    override_action { none {} }
    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesCommonRuleSet"
        vendor_name = "AWS"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${local.name}-common"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "RateLimit"
    priority = 2
    action { block {} }
    statement {
      rate_based_statement {
        limit              = var.waf_rate_limit_per_5m
        aggregate_key_type = "IP"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${local.name}-ratelimit"
      sampled_requests_enabled   = true
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "${local.name}-waf"
    sampled_requests_enabled   = true
  }
}

resource "aws_wafv2_web_acl_association" "api" {
  resource_arn = aws_lb.api.arn
  web_acl_arn  = aws_wafv2_web_acl.api.arn
}

# -----------------------------------------------------------------------------
# ECS (Fargate) - single service for demo
# -----------------------------------------------------------------------------
resource "aws_ecs_cluster" "main" {
  name = "${local.name}-cluster"
}

data "aws_iam_policy_document" "ecs_task_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "task_execution" {
  name               = "${local.name}-task-exec"
  assume_role_policy = data.aws_iam_policy_document.ecs_task_assume.json
}

resource "aws_iam_role_policy_attachment" "task_exec" {
  role       = aws_iam_role.task_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role" "task" {
  name               = "${local.name}-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_task_assume.json
}

data "aws_iam_policy_document" "task_policy" {
  statement {
    actions = [
      "secretsmanager:GetSecretValue",
    ]
    resources = [aws_secretsmanager_secret.neo4j.arn]
  }
  statement {
    actions   = ["dynamodb:PutItem"]
    resources = [aws_dynamodb_table.events.arn]
  }
}

resource "aws_iam_policy" "task" {
  name   = "${local.name}-task"
  policy = data.aws_iam_policy_document.task_policy.json
}

resource "aws_iam_role_policy_attachment" "task" {
  role       = aws_iam_role.task.name
  policy_arn = aws_iam_policy.task.arn
}

resource "aws_ecs_task_definition" "api" {
  family                   = "${local.name}-api"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.container_cpu
  memory                   = var.container_memory
  execution_role_arn        = aws_iam_role.task_execution.arn
  task_role_arn             = aws_iam_role.task.arn

  container_definitions = jsonencode([
    {
      name      = "api"
      image     = "${aws_ecr_repository.api.repository_url}:latest"
      essential = true
      portMappings = [
        { containerPort = 8000, hostPort = 8000, protocol = "tcp" }
      ]
      environment = [
        { name = "NODE_ENV", value = "production" },
        { name = "DEMO_MODE", value = "true" },
        { name = "DEMO_ALLOW_WRITES", value = "false" },
        { name = "DEMO_TENANT_ID", value = "demo" },
        { name = "DEMO_SAFE_WRITE_PATHS", value = "/ai/chat,/ai/semantic-search,/events" },
        { name = "DEMO_RATE_LIMIT_PER_IP_PER_MIN", value = "120" },
        { name = "DEMO_RATE_LIMIT_PER_SESSION_PER_MIN", value = "60" },
        { name = "EVENTS_DDB_TABLE", value = aws_dynamodb_table.events.name },
      ]
      secrets = [
        { name = "NEO4J_URI", valueFrom = "${aws_secretsmanager_secret.neo4j.arn}:uri::" },
        { name = "NEO4J_USER", valueFrom = "${aws_secretsmanager_secret.neo4j.arn}:user::" },
        { name = "NEO4J_PASSWORD", valueFrom = "${aws_secretsmanager_secret.neo4j.arn}:password::" },
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.api.name
          awslogs-region        = var.aws_region
          awslogs-stream-prefix = "api"
        }
      }
      healthCheck = {
        command     = ["CMD-SHELL", "python -c 'import urllib.request; urllib.request.urlopen(\"http://127.0.0.1:8000/\")'"]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 30
      }
    }
  ])
}

resource "aws_ecs_service" "api" {
  name            = "${local.name}-api"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.api.arn
  desired_count   = var.desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = [aws_subnet.private_a.id, aws_subnet.private_b.id]
    security_groups  = [aws_security_group.api.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.api.arn
    container_name   = "api"
    container_port   = 8000
  }

  depends_on = [aws_lb_listener.http_forward, aws_lb_listener.http_redirect, aws_lb_listener.https]
}

# -----------------------------------------------------------------------------
# CloudWatch Dashboard (minimal)
# -----------------------------------------------------------------------------
resource "aws_cloudwatch_dashboard" "demo" {
  dashboard_name = "${local.name}"
  dashboard_body = jsonencode({
    widgets = [
      {
        type = "metric",
        width = 12,
        height = 6,
        properties = {
          title = "ALB latency + 5xx"
          region = var.aws_region
          metrics = [
            [ "AWS/ApplicationELB", "TargetResponseTime", "LoadBalancer", aws_lb.api.arn_suffix ],
            [ ".", "HTTPCode_ELB_5XX_Count", ".", "." ],
            [ ".", "HTTPCode_Target_5XX_Count", ".", "." ],
          ]
        }
      },
      {
        type = "metric",
        width = 12,
        height = 6,
        properties = {
          title = "ECS CPU/Memory"
          region = var.aws_region
          metrics = [
            [ "AWS/ECS", "CPUUtilization", "ClusterName", aws_ecs_cluster.main.name, "ServiceName", aws_ecs_service.api.name ],
            [ ".", "MemoryUtilization", ".", ".", ".", "." ],
          ]
        }
      }
    ]
  })
}

# -----------------------------------------------------------------------------
# Budgets (optional)
# -----------------------------------------------------------------------------
resource "aws_budgets_budget" "monthly" {
  count        = var.budget_email != "" ? 1 : 0
  name         = "${local.name}-monthly"
  budget_type  = "COST"
  limit_amount = tostring(var.budget_monthly_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  notification {
    comparison_operator = "GREATER_THAN"
    threshold          = 80
    threshold_type     = "PERCENTAGE"
    notification_type  = "ACTUAL"

    subscriber_email_addresses = [var.budget_email]
  }

  notification {
    comparison_operator = "GREATER_THAN"
    threshold          = 100
    threshold_type     = "PERCENTAGE"
    notification_type  = "FORECASTED"

    subscriber_email_addresses = [var.budget_email]
  }
}


