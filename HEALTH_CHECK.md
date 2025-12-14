# Health Check Checklist

## ✅ Automated Checks (via CLI)

### DNS Resolution
- ✅ **api-demo.sanjayanasuri.com**: Resolves correctly (34.200.145.5, 35.174.33.87)
- ⚠️ **demo.sanjayanasuri.com**: Resolves to CloudFront IPs (13.32.205.x)
- ❌ **www.demo.sanjayanasuri.com**: **NOT RESOLVING** - This is the main issue!

### SSL Certificates
- ✅ **demo.sanjayanasuri.com**: Valid SSL cert (CN=*.demo.sanjayanasuri.com, valid from Dec 13 2025)
- ❌ **www.demo.sanjayanasuri.com**: Could not verify (DNS not resolving)
- ✅ **api-demo.sanjayanasuri.com**: Valid SSL cert

### HTTP/HTTPS Connectivity
- ⚠️ **demo.sanjayanasuri.com**: Returns 404 (CloudFront error)
- ❌ **www.demo.sanjayanasuri.com**: Cannot connect (DNS not resolving)
- ✅ **api-demo.sanjayanasuri.com**: Responds (returns JSON)

### Route53 DNS Records
- ✅ **api-demo.sanjayanasuri.com**: A record (Alias to ALB) - ✅ Working
- ✅ **demo.sanjayanasuri.com**: A record (Alias to CloudFront) - ⚠️ Configured but 404
- ❓ **www.demo.sanjayanasuri.com**: Need to verify if CNAME exists

---

## 🔍 Manual Checks Needed (Amplify Console)

### 1. Amplify App Status
- [ ] Go to: https://console.aws.amazon.com/amplify/home?region=us-east-1
- [ ] Find your app (with demo.sanjayanasuri.com)
- [ ] Check **Build status**: Is the latest build successful?
- [ ] Check **Deployment status**: Is it deployed?
- [ ] Check **Branch**: Is `main` branch active?

### 2. Domain Management
- [ ] Go to **Domain management** in Amplify
- [ ] Check **demo.sanjayanasuri.com** status:
  - [ ] Status should be "Available" (green)
  - [ ] SSL certificate should show "Amplify managed"
  - [ ] Check for any warnings or errors
- [ ] Check **www.demo.sanjayanasuri.com** subdomain:
  - [ ] Does it exist in the subdomain list?
  - [ ] Is it mapped to `main` branch?
  - [ ] What status does it show? (Available/Pending/Error)
  - [ ] Are there any error messages?

### 3. Build & Deploy
- [ ] Check **App settings** → **Build settings**:
  - [ ] Is `amplify.yml` being used?
  - [ ] Are environment variables set? (NEXT_PUBLIC_API_URL, NEXT_PUBLIC_DEMO_MODE)
- [ ] Check **Deployments**:
  - [ ] Is there a recent successful deployment?
  - [ ] When was the last deployment?
  - [ ] Are there any failed deployments?

### 4. Frontend Functionality (Browser Test)
- [ ] Open https://demo.sanjayanasuri.com in browser:
  - [ ] Does it load? (Currently getting 404)
  - [ ] Does it redirect to www? (You have redirect enabled)
  - [ ] Check browser console for errors (F12 → Console)
  - [ ] Check Network tab - what status codes do you see?
- [ ] Open https://www.demo.sanjayanasuri.com in browser:
  - [ ] Does it load? (Currently DNS not resolving)
  - [ ] Check browser console for errors
  - [ ] Check Network tab

### 5. API Functionality
- [ ] Test API endpoints:
  - [ ] https://api-demo.sanjayanasuri.com/ (should return API info or 404 for root)
  - [ ] Test a known endpoint (e.g., /nodes, /edges, /health if exists)
  - [ ] Check CORS headers if calling from frontend

### 6. Route53 Console Check
- [ ] Go to: https://console.aws.amazon.com/route53/v2/hostedzones
- [ ] Select zone: `sanjayanasuri.com`
- [ ] Check for **www.demo** record:
  - [ ] Does a CNAME record exist for `www.demo.sanjayanasuri.com`?
  - [ ] What does it point to? (Should be something like `xxxxx.amplifyapp.com` or CloudFront)
  - [ ] If it doesn't exist, that's the problem!

---

## 🐛 Issues Found

### Critical Issues:
1. **www.demo.sanjayanasuri.com DNS not resolving**
   - Either the Route53 CNAME record doesn't exist
   - Or Amplify hasn't created/provided the DNS record yet
   - **Action**: Check Route53 for www.demo CNAME record

2. **demo.sanjayanasuri.com returning 404**
   - DNS resolves, SSL works, but CloudFront returns 404
   - Could mean:
     - Amplify build/deployment issue
     - CloudFront distribution not properly configured
     - Origin (S3/Amplify) not serving content correctly
   - **Action**: Check Amplify deployment status

### Working:
- ✅ API domain (api-demo.sanjayanasuri.com) - Fully functional
- ✅ SSL certificates - Valid
- ✅ Route53 configuration for API - Correct

---

## 🔧 Next Steps

1. **Check Route53 for www.demo CNAME**:
   - If missing, add it (get value from Amplify console)
   - If exists, verify it points to correct CloudFront/Amplify domain

2. **Check Amplify deployment**:
   - Ensure latest build is successful
   - Verify app is actually deployed
   - Check if www subdomain is properly configured

3. **Fix www subdomain in Amplify**:
   - Remove and re-add if needed
   - Wait 15-30 minutes for CloudFront update

4. **Fix main domain 404**:
   - Check if build artifacts are correct
   - Verify amplify.yml configuration
   - Check if Next.js build is producing correct output
