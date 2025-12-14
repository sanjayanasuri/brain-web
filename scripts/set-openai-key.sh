#!/bin/bash
# Script to set OpenAI API key in AWS Secrets Manager for demo

if [ -z "$1" ]; then
  echo "Usage: ./scripts/set-openai-key.sh YOUR_OPENAI_API_KEY"
  echo ""
  echo "Example:"
  echo "  ./scripts/set-openai-key.sh sk-proj-..."
  exit 1
fi

OPENAI_KEY="$1"
SECRET_NAME="brain-web-demo/openai"
REGION="us-east-1"

echo "🔐 Setting OpenAI API key in AWS Secrets Manager..."
echo ""

# Check if secret exists, create if not
if ! aws secretsmanager describe-secret --secret-id "$SECRET_NAME" --region "$REGION" &>/dev/null; then
  echo "Creating secret: $SECRET_NAME"
  aws secretsmanager create-secret \
    --name "$SECRET_NAME" \
    --description "OpenAI API key for Brain Web demo" \
    --region "$REGION" \
    --secret-string '{"api_key":""}'
fi

# Set the secret value
echo "Setting API key value..."
aws secretsmanager put-secret-value \
  --secret-id "$SECRET_NAME" \
  --secret-string "{\"api_key\":\"$OPENAI_KEY\"}" \
  --region "$REGION"

if [ $? -eq 0 ]; then
  echo "✅ OpenAI API key set successfully!"
  echo ""
  echo "The backend will automatically pick up this key on next deployment."
  echo "To apply Terraform changes:"
  echo "  cd infra/envs/demo && terraform apply -var='openai_api_key=$OPENAI_KEY'"
else
  echo "❌ Failed to set OpenAI API key"
  exit 1
fi
