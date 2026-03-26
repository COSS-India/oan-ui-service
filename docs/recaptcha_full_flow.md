# reCAPTCHA v3 Full Implementation Flow (Frontend + Backend)

## Overview
Complete integration of Google reCAPTCHA v3 into the chatbot token generation flow. Frontend executes reCAPTCHA, sends token to backend, backend verifies with Google, and returns token on pass.

## Backend Implementation (bharat-oan-api)

### Modified Files
- `app/routers/token.py`: Added reCAPTCHA verification logic.
- `.env`: Added `RECAPTCHA_SECRET_KEY`.

### Code Changes
```python
# Added imports
from fastapi import Request
import requests

# Changed signature
async def create_auth_token(request: Request):

    # Read token
    data = await request.json()
    recaptcha_token = data.get("recaptchaToken")
    if not recaptcha_token:
        return {"error": "recaptchaToken missing"}, 400

    # Verify with Google
    recaptcha_secret = os.getenv("RECAPTCHA_SECRET_KEY")
    resp = requests.post("https://www.google.com/recaptcha/api/siteverify", data={
        "secret": recaptcha_secret,
        "response": recaptcha_token,
    }, timeout=5)
    recaptcha_result = resp.json()

    # Check results
    if not recaptcha_result.get("success"):
        return {"error": "recaptcha failed"}, 400
    if recaptcha_result.get("score", 0) < 0.5:
        return {"error": "low score"}, 403

    # Generate token (dummy for demo)
    import uuid
    token = str(uuid.uuid4())
    return {"token": token, "expires_in": 900}
```

## Frontend Implementation (oan-ui-service)

### Modified Files
- `src/lib/api.ts`: Added reCAPTCHA execution in `fetchAuthToken`.
- `index.html`: Added reCAPTCHA script.
- `.env`: Added site key.

### Added Files
- `src/components/RecaptchaTokenDemo.tsx`: Demo component.

### Code Changes
```typescript
// In api.ts fetchAuthToken
const siteKey = import.meta.env.VITE_RECAPTCHA_SITE_KEY;
if (!(window as any).grecaptcha) {
  throw new Error("grecaptcha not loaded");
}
const recaptchaToken = await (window as any).grecaptcha.execute(siteKey, { action: "token" });

// Send in body
const response = await axios.post("/api/token", {
  recaptchaToken,
  metadata,
});
```

```html
<!-- In index.html -->
<script src="https://www.google.com/recaptcha/api.js?render=6LdLa5ksAAAAAMmELly2HOBLsEz4iLfR2XiPDh5l" async defer></script>
```

## Testing Details

### Pass Scenario
- Frontend gets valid token from `grecaptcha.execute`.
- Backend receives, verifies with Google (score >= 0.5).
- Returns 200 with token.

### Fail Scenarios
1. **Missing Token**: Send request without `recaptchaToken` → 400.
2. **Invalid Token**: Send fake token → 400 "recaptcha failed".
3. **Low Score**: Modify backend threshold to 0.99 → 403 "low score".

### Test Commands
```bash
# Pass (with real token)
curl -X POST http://localhost:8000/api/token \
  -H 'Content-Type: application/json' \
  -d '{"recaptchaToken":"<real-token>", "metadata":"test"}'

# Fail (invalid token)
curl -X POST http://localhost:8000/api/token \
  -H 'Content-Type: application/json' \
  -d '{"recaptchaToken":"invalid", "metadata":"test"}'
```

### Demo Component
- Import `RecaptchaTokenDemo` in app.
- Click button to test flow.
- Alerts token on success, error on fail.

### Google Admin Setup
- Register reCAPTCHA v3 site.
- Domains: `localhost`, `127.0.0.1`.
- Use provided site/secret keys.

## Dependencies
- Backend: `requests`
- Frontend: `axios`, reCAPTCHA script

## Notes
- Token generation simplified to UUID for demo.
- Threshold 0.5 for pass, adjustable.
- CORS enabled for localhost testing.