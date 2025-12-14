#!/bin/bash
# Helper script to create IAM role for GitHub Actions OIDC
# Run this ONCE, then add the role ARN to GitHub secrets

set -euo pipefail

AWS_REGION="${AWS_REGION:-us-east-1}"
ROLE_NAME="brain-web-demo-github-deploy"
GITHUB_REPO="sanjayanasuri/brain-web"  # Change if your repo is different

echo "Creating IAM role for GitHub Actions..."
echo "Repo: $GITHUB_REPO"
echo ""

# Create trust policy for GitHub OIDC
cat > /tmp/github-trust-policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::$(aws sts get-caller-identity --query Account --output text):oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
        },
        "StringLike": {
          "token.actions.githubusercontent.com:sub": "repo:${GITHUB_REPO}:*"
        }
      }
    }
  ]
}
EOF

# Check if OIDC provider exists, create if not
PROVIDER_ARN="arn:aws:iam::$(aws sts get-caller-identity --query Account --output text):oidc-provider/token.actions.githubusercontent.com"
if ! aws iam get-open-id-connect-provider --open-id-connect-provider-arn "$PROVIDER_ARN" &>/dev/null; then
  echo "Creating OIDC provider for GitHub..."
  aws iam create-open-id-connect-provider \
    --url "https://token.actions.githubusercontent.com" \
    --client-id-list "sts.amazonaws.com" \
    --thumbprint-list "6938fd4d98bab03faadb97b34396831e3780aea1" \
    --region "$AWS_REGION" || echo "Provider may already exist, continuing..."
else
  echo "OIDC provider already exists, skipping..."
fi

# Create the role
echo "Creating IAM role: $ROLE_NAME"
aws iam create-role \
  --role-name "$ROLE_NAME" \
  --assume-role-policy-document file:///tmp/github-trust-policy.json \
  --description "Allows GitHub Actions to deploy to ECS/ECR" \
  --region "$AWS_REGION" || {
    echo "Role may already exist. Updating trust policy..."
    aws iam update-assume-role-policy \
      --role-name "$ROLE_NAME" \
      --policy-document file:///tmp/github-trust-policy.json \
      --region "$AWS_REGION"
  }

# Attach policies (inline policy with minimal permissions)
cat > /tmp/github-policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ecr:GetAuthorizationToken",
        "ecr:BatchCheckLayerAvailability",
        "ecr:GetDownloadUrlForLayer",
        "ecr:BatchGetImage",
        "ecr:PutImage",
        "ecr:InitiateLayerUpload",
        "ecr:UploadLayerPart",
        "ecr:CompleteLayerUpload"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "ecs:DescribeServices",
        "ecs:DescribeTaskDefinition",
        "ecs:RegisterTaskDefinition",
        "ecs:UpdateService",
        "ecs:DescribeTasks"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "iam:PassRole"
      ],
      "Resource": "arn:aws:iam::$(aws sts get-caller-identity --query Account --output text):role/brain-web-demo-*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      "Resource": "arn:aws:logs:${AWS_REGION}:$(aws sts get-caller-identity --query Account --output text):*"
    }
  ]
}
EOF

echo "Attaching inline policy to role..."
aws iam put-role-policy \
  --role-name "$ROLE_NAME" \
  --policy-name "GitHubActionsDeployPolicy" \
  --policy-document file:///tmp/github-policy.json \
  --region "$AWS_REGION"

# Get the role ARN
ROLE_ARN=$(aws iam get-role --role-name "$ROLE_NAME --query Role.Arn --output text --region "$AWS_REGION")

echo ""
echo "✅ IAM role created successfully!"
echo ""
echo "📋 Add this to GitHub Secrets:"
echo "   Secret name: AWS_ROLE_TO_ASSUME"
echo "   Secret value: $ROLE_ARN"
echo ""
echo "📋 Also add these GitHub Secrets:"
echo "   AWS_REGION = us-east-1"
echo "   ECR_REPO = brain-web-demo-api"
echo "   ECS_CLUSTER = brain-web-demo-cluster"
echo "   ECS_SERVICE = brain-web-demo-api"
echo ""
echo "Then push to GitHub main branch to trigger deployment!"

