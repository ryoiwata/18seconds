# @superstarter/iac

Minimum-viable AWS infrastructure for superstarter:

- One **RDS Postgres** instance in the AWS account's default VPC, smallest sizing (`db.t4g.micro`, single AZ, 20 GB gp3, no backups, no deletion protection).
- One **IAM OIDC provider** federated with Vercel.
- One **IAM role** assumable by the Vercel project via OIDC, granted `rds-db:connect` for the `app` database user.
- Master password is auto-generated and stored in **AWS Secrets Manager** (used only by the deployer locally for `db:push:programs` and migrations — never by the app).

The app itself connects as the `app` user with **RDS IAM authentication** — no DB password ever lives in env vars or Vercel.

## Team model — no per-user lockdown

Any AWS principal in the org with the right IAM permissions can run `bun run deploy` to mutate this stack. There is no breakglass user, no resource-policy denial, no role-shape requirement on the deployer (it just calls `sts:GetCallerIdentity` to learn the account ID).

State is shared via **git**, the idiomatic Alchemy way: `packages/superstarter-iac/.alchemy/` is committed to the repo. Each deployer:

1. `git pull` first to pick up the latest state.
2. Runs `bun run deploy`.
3. `git commit` + `git push` the updated `.alchemy/` so teammates inherit the new state on their next pull.

`ALCHEMY_PASSWORD` (which decrypts secrets in the state files) lives in a shared password manager — share it the same way you'd share any other team secret.

## Prerequisites

- AWS credentials available to the local shell (`~/.aws/credentials` or `AWS_*` env vars). The credentials must be able to provision IAM, EC2, and RDS resources in `us-east-1`.
- The AWS account must have a **default VPC** in `us-east-1`. If it doesn't, run `aws ec2 create-default-vpc --region us-east-1` once before deploying.
- Vercel project created (note its team slug and project name).

## Required env vars

| Variable | Notes |
|---|---|
| `VERCEL_TEAM_SLUG` | Slug of your Vercel team (e.g. from the dashboard URL). |
| `VERCEL_PROJECT_NAME` | Project name (defaults to `superstarter`). |
| `ALCHEMY_PASSWORD` | ≥ 32 chars; encrypts secrets inside the committed `.alchemy/` state files. Shared across the team via password manager. |
| `AWS_REGION` | Must be `us-east-1` (default). |

## Deploy

```bash
cd packages/superstarter-iac
git pull
VERCEL_TEAM_SLUG=<slug> ALCHEMY_PASSWORD=<32+ char secret> bun run deploy
git add .alchemy && git commit -m "iac: deploy" && git push
```

The deploy logs print the env vars to paste into your Vercel project:

- `AWS_ROLE_ARN` — the IAM role the Vercel runtime assumes via OIDC
- `DATABASE_HOST` — the RDS endpoint
- `DATABASE_ADMIN_SECRET_ARN` — the master secret ARN (set this **only in your local `.env`**, used by `db:push:programs` and migrations; do **not** add to Vercel)

`VERCEL_OIDC_TOKEN` is auto-injected by Vercel — no paste needed.

## Bootstrap the database

After the IaC deploy, with the env vars set in `.env`:

```bash
bun db:push:programs   # creates the `app` user, grants rds_iam, installs pgcrypto
bun db:push            # pushes the table schema (core_todos, …)
```

## Destroy

```bash
bun run destroy
git add .alchemy && git commit -m "iac: destroy" && git push
```

This deletes everything provisioned. The RDS instance has no deletion protection and no final snapshot — use with care.
