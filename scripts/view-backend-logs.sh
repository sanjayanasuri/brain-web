#!/bin/bash
# View backend logs in real-time with filtering options

LOG_GROUP="/ecs/brain-web-demo-api"
REGION="us-east-1"

echo "📊 Brain Web Backend Logs"
echo "=========================="
echo ""
echo "Options:"
echo "  1. All logs (last 10 minutes)"
echo "  2. Errors only"
echo "  3. Demo mode enforcement (write blocks, rate limits)"
echo "  4. All requests"
echo "  5. Follow (real-time tail)"
echo ""
read -p "Select option (1-5): " choice

case $choice in
  1)
    echo "📋 Showing all logs (last 10 minutes)..."
    aws logs tail "$LOG_GROUP" --since 10m --region "$REGION" --format short
    ;;
  2)
    echo "❌ Showing errors only..."
    aws logs tail "$LOG_GROUP" --since 10m --region "$REGION" --format short --filter-pattern "ERROR"
    ;;
  3)
    echo "🔒 Showing demo mode enforcement..."
    aws logs tail "$LOG_GROUP" --since 10m --region "$REGION" --format short --filter-pattern "demo_write_blocked demo_write_allowed rate_limit_exceeded demo_blocked"
    ;;
  4)
    echo "📡 Showing all requests..."
    aws logs tail "$LOG_GROUP" --since 10m --region "$REGION" --format short --filter-pattern "event.*request"
    ;;
  5)
    echo "👀 Following logs in real-time (Ctrl+C to stop)..."
    aws logs tail "$LOG_GROUP" --follow --region "$REGION" --format short
    ;;
  *)
    echo "Invalid option. Showing all logs..."
    aws logs tail "$LOG_GROUP" --since 10m --region "$REGION" --format short
    ;;
esac
