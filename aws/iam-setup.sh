## IAM roles needed for ECS Fargate deployment
##
## Run these AWS CLI commands ONCE to set up the required IAM roles.
## Replace YOUR_ACCOUNT_ID and YOUR_REGION throughout.

# ── 1. ECS Task Execution Role (allows ECS to pull images + read secrets) ────
aws iam create-role \
  --role-name ecsTaskExecutionRole \
  --assume-role-policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Principal": {"Service": "ecs-tasks.amazonaws.com"},
      "Action": "sts:AssumeRole"
    }]
  }'

aws iam attach-role-policy \
  --role-name ecsTaskExecutionRole \
  --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy

# Allow reading from Secrets Manager
aws iam attach-role-policy \
  --role-name ecsTaskExecutionRole \
  --policy-arn arn:aws:iam::aws:policy/SecretsManagerReadWrite


# ── 2. App Task Role (permissions the app itself needs at runtime) ────────────
aws iam create-role \
  --role-name optionflow-task-role \
  --assume-role-policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Principal": {"Service": "ecs-tasks.amazonaws.com"},
      "Action": "sts:AssumeRole"
    }]
  }'

# (Add extra policies here if the app needs S3, SES, etc.)


# ── 3. GitHub Actions OIDC Role (allows CI to push to ECR + update ECS) ─────
# First, create the OIDC provider for GitHub (only needed once per account):
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com \
  --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1

# Create the role GitHub Actions will assume:
aws iam create-role \
  --role-name github-actions-optionflow \
  --assume-role-policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::YOUR_ACCOUNT_ID:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringLike": {
          "token.actions.githubusercontent.com:sub": "repo:Karthikkv12/million-app:*"
        },
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
        }
      }
    }]
  }'

aws iam attach-role-policy \
  --role-name github-actions-optionflow \
  --policy-arn arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryPowerUser

aws iam attach-role-policy \
  --role-name github-actions-optionflow \
  --policy-arn arn:aws:iam::aws:policy/AmazonECS_FullAccess
