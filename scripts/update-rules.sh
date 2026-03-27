#!/bin/bash
# scripts/update-rules.sh
set -e

# 1. Configuration
APP_ID=$1       # e.g., AppConfig Application ID
ENV_ID=$2       # e.g., AppConfig Environment ID
PROFILE_ID=$3   # e.g., AppConfig Configuration Profile ID
CONFIG_FILE=$4  # e.g., "rules.json"
REGION=${5:-ap-south-1}
PROFILE=${6:-personal-ai}

if [[ -z "$APP_ID" || -z "$ENV_ID" || -z "$PROFILE_ID" || -z "$CONFIG_FILE" ]]; then
    echo "Usage: $0 <app-id> <env-id> <profile-id> <json-file> [region] [aws-profile]"
    echo "Example: $0 abc123 env456 xyz789 rules.json ap-south-1 personal-ai"
    exit 1
fi

AWS_OPTS="--region $REGION --profile $PROFILE"

echo "🚀 Updating AppConfig rules (region=$REGION, profile=$PROFILE)..."

# 2. Create a new hosted configuration version
# AWS CLI requires a positional argument to save the content of the config version created.
echo "-> Creating new version from $CONFIG_FILE..."
VERSION=$(aws appconfig create-hosted-configuration-version \
    $AWS_OPTS \
    --application-id "$APP_ID" \
    --configuration-profile-id "$PROFILE_ID" \
    --content "fileb://$CONFIG_FILE" \
    --content-type "application/json" \
    --query 'VersionNumber' \
    --output text \
    /tmp/rules_version_response)

echo "✅ Created version: $VERSION"

# 3. Start a deployment
echo "-> Starting deployment of version $VERSION..."
aws appconfig start-deployment \
    $AWS_OPTS \
    --application-id "$APP_ID" \
    --environment-id "$ENV_ID" \
    --configuration-profile-id "$PROFILE_ID" \
    --configuration-version "$VERSION" \
    --deployment-strategy-id "AppConfig.AllAtOnce"

echo "🔥 Deployment started! The sidecar will pick this up in ~15 seconds."
