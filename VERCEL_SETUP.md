# Vercel Frontend Setup for Railway Backend

## Quick Setup

### Step 1: Connect Repository to Vercel
1. Go to [vercel.com](https://vercel.com)
2. Click "Add New Project"
3. Import your `brain-web` repository
4. Vercel will auto-detect Next.js

### Step 2: Configure Build Settings
Vercel should auto-detect from `vercel.json`, but verify:
- **Root Directory**: `frontend` (if not auto-detected)
- **Framework Preset**: Next.js
- **Build Command**: `npm run build` (runs in `frontend/` directory)
- **Output Directory**: `.next`

### Step 3: Set Environment Variables
Go to **Settings** → **Environment Variables** and add:

#### Required:
```
NEXT_PUBLIC_API_URL=https://your-railway-url.railway.app
```
Replace `your-railway-url` with your actual Railway backend URL (e.g., `brain-web-production.up.railway.app`)

#### Optional (for full AI features):
```
OPENAI_API_KEY=sk-proj-...
```
Only needed if you want AI chat to work. Can be left empty for demo (chat will be disabled).

### Step 4: Deploy
1. Click "Deploy"
2. Vercel will build and deploy your frontend
3. You'll get a URL like: `brain-web.vercel.app`

### Step 5: Set Custom Domain (Optional)
1. Go to **Settings** → **Domains**
2. Add `demo.sanjayanasuri.com`
3. Update DNS:
   - Add CNAME record: `demo` → `cname.vercel-dns.com`
   - Or use Vercel's nameservers if managing DNS through Vercel

## Environment Variables Reference

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `NEXT_PUBLIC_API_URL` | ✅ Yes | Railway backend URL | `https://brain-web-production.up.railway.app` |
| `OPENAI_API_KEY` | ❌ No | OpenAI API key for AI chat | `sk-proj-...` |

## Testing

After deployment:
1. Visit your Vercel URL
2. Check browser console for any API connection errors
3. Test the graph visualization
4. Test AI chat (if `OPENAI_API_KEY` is set)

## Troubleshooting

### Frontend can't connect to backend
- Verify `NEXT_PUBLIC_API_URL` is set correctly in Vercel
- Check Railway backend is running and accessible
- Check CORS settings in backend (should allow Vercel domain)

### Build fails
- Check that `frontend/` directory exists
- Verify `package.json` is in `frontend/` directory
- Check build logs in Vercel dashboard

### API calls return CORS errors
- Update `backend/main.py` CORS origins to include your Vercel domain
- Add your Vercel URL to allowed origins list
