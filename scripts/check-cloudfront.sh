#!/bin/bash
# Script to check CloudFront distribution for demo domain

echo "=== Checking CloudFront Distributions ==="
echo ""

# Find distribution with demo.sanjayanasuri.com
DIST_ID=$(aws cloudfront list-distributions --output json 2>/dev/null | \
  jq -r '.DistributionList.Items[] | select(.Aliases.Items != null and (.Aliases.Items[]? | contains("demo.sanjayanasuri.com"))) | .Id' | head -1)

if [ -z "$DIST_ID" ]; then
  echo "❌ No CloudFront distribution found with demo.sanjayanasuri.com alias"
  echo ""
  echo "Listing all distributions:"
  aws cloudfront list-distributions --output json 2>/dev/null | \
    jq -r '.DistributionList.Items[] | "\(.Id) - \(.DomainName) - Aliases: \(.Aliases.Items // [] | join(", "))"'
  exit 1
fi

echo "✅ Found distribution: $DIST_ID"
echo ""

# Get distribution details
echo "=== Distribution Details ==="
aws cloudfront get-distribution --id "$DIST_ID" --output json 2>/dev/null | jq -r '{
  Id: .Distribution.Id,
  Status: .Distribution.Status,
  DomainName: .Distribution.DomainName,
  Aliases: .Distribution.Aliases.Items,
  LastModifiedTime: .Distribution.LastModifiedTime,
  Enabled: .Distribution.Enabled
}'

echo ""
echo "=== Checking for www subdomain ==="
HAS_WWW=$(aws cloudfront get-distribution --id "$DIST_ID" --output json 2>/dev/null | \
  jq -r '.Distribution.Aliases.Items[]? | select(contains("www.demo.sanjayanasuri.com"))')

if [ -z "$HAS_WWW" ]; then
  echo "❌ www.demo.sanjayanasuri.com is NOT in the Alternate Domain Names (CNAMEs)"
  echo "   This is why you're getting 404 errors!"
  echo ""
  echo "Current aliases:"
  aws cloudfront get-distribution --id "$DIST_ID" --output json 2>/dev/null | \
    jq -r '.Distribution.Aliases.Items[]?'
else
  echo "✅ www.demo.sanjayanasuri.com is configured"
fi

echo ""
echo "=== Distribution Status ==="
STATUS=$(aws cloudfront get-distribution --id "$DIST_ID" --output json 2>/dev/null | jq -r '.Distribution.Status')
if [ "$STATUS" != "Deployed" ]; then
  echo "⚠️  Status: $STATUS (still deploying - wait for it to show 'Deployed')"
else
  echo "✅ Status: $STATUS"
fi
