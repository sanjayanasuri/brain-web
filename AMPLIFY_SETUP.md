# Amplify Frontend Setup Guide

## Step 1: Create Amplify App (AWS Console)

1. Go to: https://console.aws.amazon.com/amplify/home?region=us-east-1
2. Click **"New app"** → **"Host web app"**
3. Select **"GitHub"** as source
4. Authorize AWS Amplify to access your GitHub (if first time)
5. Select repository: **`sanjayanasuri/brain-web`**
6. Select branch: **`main`**
7. **App name**: `brain-web-demo-frontend`
8. Click **"Next"**

## Step 2: Configure Build Settings

The build settings should auto-detect from `amplify.yml` in your repo root.

**Verify these settings:**
- **App root**: Leave empty (monorepo root)
- **Build settings**: Should show `amplify.yml` from repo
- **Environment variables** (click "Add environment variable"):
  - `NEXT_PUBLIC_API_URL` = `https://api-demo.sanjayanasuri.com`
  - `NEXT_PUBLIC_DEMO_MODE` = `true`

Click **"Next"** → **"Save and deploy"**

## Step 3: Add Custom Domain

1. After the first deployment starts, go to **"Domain management"** in the left sidebar
2. Click **"Add domain"**
3. Enter: `demo.sanjayanasuri.com`
4. Click **"Configure domain"**
5. Select the `main` branch for the root domain
6. Click **"Save"**

## Step 4: DNS Configuration

Amplify will show you DNS records to add. You need to add a CNAME record in Route53:

1. Go to Route53: https://console.aws.amazon.com/route53/v2/hostedzones
2. Select your hosted zone: `sanjayanasuri.com`
3. Click **"Create record"**
4. **Record name**: `demo` (or leave blank for apex)
5. **Record type**: `CNAME`
6. **Value**: Copy from Amplify domain setup (looks like `xxxxx.amplifyapp.com`)
7. Click **"Create records"**

## Step 5: Wait for SSL Certificate

Amplify will automatically provision an SSL certificate. This takes 5-15 minutes.

## Step 6: Verify Deployment

Once complete, visit: `https://demo.sanjayanasuri.com`

---

**Alternative: Use AWS CLI** (if you prefer command line)

```bash
aws amplify create-app \
  --name brain-web-demo-frontend \
  --repository https://github.com/sanjayanasuri/brain-web \
  --platform WEB \
  --environment-variables NEXT_PUBLIC_API_URL=https://api-demo.sanjayanasuri.com,NEXT_PUBLIC_DEMO_MODE=true \
  --region us-east-1
```

