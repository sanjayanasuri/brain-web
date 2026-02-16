# Vercel Environment Configuration

This guide explains how to configure your Vercel frontend to connect to your Hetzner backend.

## Environment Variable Setup

### Option 1: Using Vercel Dashboard (Recommended)

1. Go to your project on [Vercel Dashboard](https://vercel.com/dashboard)
2. Navigate to **Settings** → **Environment Variables**
3. Add the following variable:

   **Name:** `NEXT_PUBLIC_API_URL`  
   **Value:** `https://demo.sanjayanasuri.com`  
   **Environment:** Production, Preview, Development

4. Click **Save**
5. Redeploy your application

### Option 2: Using Vercel CLI

```bash
# Install Vercel CLI if not already installed
npm i -g vercel

# Set environment variable
vercel env add NEXT_PUBLIC_API_URL production
# When prompted, enter: https://demo.sanjayanasuri.com

# Redeploy
vercel --prod
```

## Verification

After updating the environment variable and redeploying:

1. **Check Frontend Build Logs:**
   - Go to Vercel Dashboard → Deployments
   - Click on latest deployment
   - Verify `NEXT_PUBLIC_API_URL` is set correctly

2. **Test API Connection:**
   - Open your deployed frontend
   - Open browser console (F12)
   - Check network tab for API requests
   - Verify requests go to `https://demo.sanjayanasuri.com`

3. **Test Functionality:**
   - Try creating a conversation
   - Check if graph data loads
   - Verify all features work correctly

## Important Notes

> [!IMPORTANT]
> - Use `https://` (not `http://`) after SSL is set up
> - The variable must start with `NEXT_PUBLIC_` to be accessible in the browser
> - You must redeploy after changing environment variables

> [!WARNING]
> - Don't commit `.env.local` files with production URLs to Git
> - Keep development and production URLs separate

## Troubleshooting

### CORS Errors
If you see CORS errors in the browser console:
- Verify the backend allows requests from your Vercel domain
- Check Nginx configuration includes proper CORS headers

### Connection Refused
If API requests fail:
- Verify SSL certificate is installed: `curl https://demo.sanjayanasuri.com/health`
- Check backend is running: `docker compose ps`
- Verify firewall allows HTTPS: `sudo ufw status`

### Mixed Content Warnings
If you see mixed content warnings:
- Ensure all API URLs use `https://` not `http://`
- Check that `NEXT_PUBLIC_API_URL` doesn't have trailing slash

## Local Development

For local development, create a `.env.local` file:

```bash
# .env.local (for local development only)
NEXT_PUBLIC_API_URL=http://localhost:8000
```

This allows you to test against your local backend while the production deployment uses the Hetzner server.
