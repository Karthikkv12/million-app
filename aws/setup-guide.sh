## OptionFlow — AWS Deployment Setup Guide
## Run these commands top-to-bottom, replacing placeholders as you go.

# Prerequisites:
#   brew install awscli docker
#   aws configure   (set your Access Key, Secret, region)

export AWS_REGION="us-east-1"          # ← change if needed
export AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
export APP="optionflow"


# ══════════════════════════════════════════════════════════════════════════════
# STEP 1 — Create ECR repository
# ══════════════════════════════════════════════════════════════════════════════

aws ecr create-repository \
  --repository-name ${APP}-api \
  --image-scanning-configuration scanOnPush=true \
  --region $AWS_REGION

echo "ECR URI: ${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${APP}-api"


# ══════════════════════════════════════════════════════════════════════════════
# STEP 2 — Create RDS PostgreSQL (free-tier eligible: db.t4g.micro)
# ══════════════════════════════════════════════════════════════════════════════
# Run this in a VPC where your ECS tasks will also run (use default VPC for now)

aws rds create-db-instance \
  --db-instance-identifier ${APP}-db \
  --db-instance-class db.t4g.micro \
  --engine postgres \
  --engine-version 16 \
  --master-username optionflow \
  --master-user-password "CHANGE_ME_STRONG_PASSWORD" \
  --db-name optionflow \
  --allocated-storage 20 \
  --storage-type gp2 \
  --no-multi-az \
  --no-publicly-accessible \
  --backup-retention-period 7 \
  --region $AWS_REGION

# Wait until available (~5 min), then get the endpoint:
aws rds describe-db-instances \
  --db-instance-identifier ${APP}-db \
  --query "DBInstances[0].Endpoint.Address" \
  --output text


# ══════════════════════════════════════════════════════════════════════════════
# STEP 3 — Store secrets in AWS Secrets Manager
# ══════════════════════════════════════════════════════════════════════════════

RDS_ENDPOINT="your-rds-endpoint.rds.amazonaws.com"   # from step 2 output

aws secretsmanager create-secret \
  --name optionflow/DATABASE_URL \
  --secret-string "postgresql://optionflow:CHANGE_ME_STRONG_PASSWORD@${RDS_ENDPOINT}:5432/optionflow"

aws secretsmanager create-secret \
  --name optionflow/JWT_SECRET \
  --secret-string "$(python3 -c 'import secrets; print(secrets.token_hex(64))')"

aws secretsmanager create-secret \
  --name optionflow/CORS_ALLOW_ORIGINS \
  --secret-string "https://your-app.vercel.app,https://optflw.com"


# ══════════════════════════════════════════════════════════════════════════════
# STEP 4 — Set up IAM roles
# ══════════════════════════════════════════════════════════════════════════════
# Run all commands in aws/iam-setup.sh (after replacing YOUR_ACCOUNT_ID/YOUR_REGION)

bash aws/iam-setup.sh


# ══════════════════════════════════════════════════════════════════════════════
# STEP 5 — Create ECS cluster
# ══════════════════════════════════════════════════════════════════════════════

aws ecs create-cluster \
  --cluster-name ${APP}-cluster \
  --capacity-providers FARGATE \
  --region $AWS_REGION


# ══════════════════════════════════════════════════════════════════════════════
# STEP 6 — Create CloudWatch log group
# ══════════════════════════════════════════════════════════════════════════════

aws logs create-log-group \
  --log-group-name /ecs/${APP}-api \
  --region $AWS_REGION


# ══════════════════════════════════════════════════════════════════════════════
# STEP 7 — Build & push first Docker image manually
# ══════════════════════════════════════════════════════════════════════════════

cd /Users/karthikkondajjividyaranya/Desktop/OptionFlow_main

aws ecr get-login-password --region $AWS_REGION \
  | docker login --username AWS --password-stdin \
    ${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com

docker build -t ${APP}-api .
docker tag ${APP}-api:latest \
  ${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${APP}-api:latest
docker push \
  ${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${APP}-api:latest


# ══════════════════════════════════════════════════════════════════════════════
# STEP 8 — Run Alembic migrations against RDS (one-time, from local machine)
# ══════════════════════════════════════════════════════════════════════════════
# Temporarily allow your IP in the RDS security group, then:

cd /Users/karthikkondajjividyaranya/Desktop/OptionFlow_main
source .venv/bin/activate

export DATABASE_URL="postgresql://optionflow:CHANGE_ME@${RDS_ENDPOINT}:5432/optionflow"

for db in users trades portfolio budget markets; do
  echo "Migrating: $db"
  ALEMBIC_DB=$db alembic upgrade head
done

# Optionally seed the admin user:
python3 scripts/create_user.py


# ══════════════════════════════════════════════════════════════════════════════
# STEP 9 — Register ECS task definition
# ══════════════════════════════════════════════════════════════════════════════
# First edit aws/ecs-task-definition.json and replace:
#   YOUR_ACCOUNT_ID → actual account ID
#   YOUR_REGION     → e.g. us-east-1
#   ECR image URI   → from step 7

aws ecs register-task-definition \
  --cli-input-json file://aws/ecs-task-definition.json \
  --region $AWS_REGION


# ══════════════════════════════════════════════════════════════════════════════
# STEP 10 — Create ALB + ECS Service (do via AWS Console or Copilot CLI)
# ══════════════════════════════════════════════════════════════════════════════
# Easiest path: use AWS Copilot (higher-level tool):
#
#   brew install aws/tap/copilot-cli
#   copilot init
#     → App name: optionflow
#     → Type: Load Balanced Web Service
#     → Service name: api
#     → Dockerfile: ./Dockerfile
#     → Port: 8000
#   copilot env init --name production
#   copilot deploy


# ══════════════════════════════════════════════════════════════════════════════
# STEP 11 — Add GitHub Actions secrets (in repo Settings → Secrets)
# ══════════════════════════════════════════════════════════════════════════════
# AWS_ACCOUNT_ID      → your 12-digit account ID
# ECS_SUBNET_IDS      → comma-separated subnet IDs from your VPC
# ECS_SECURITY_GROUP_ID → SG ID attached to your ECS tasks
# ALB_DNS_NAME        → ALB DNS name (for health check smoke test)


# ══════════════════════════════════════════════════════════════════════════════
# STEP 12 — Configure Vercel
# ══════════════════════════════════════════════════════════════════════════════
# In Vercel project settings → Environment Variables:
#   BACKEND_URL  = https://your-alb-dns.us-east-1.elb.amazonaws.com
#                  (or your custom domain after setting up Route 53 + ACM)
#
# After that, every Vercel deployment will proxy /api/* → your ALB → ECS.
