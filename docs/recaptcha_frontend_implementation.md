# reCAPTCHA v3 Frontend Implementation

## Overview
Modified the frontend to execute Google reCAPTCHA v3 before calling the `/api/token` endpoint, sending the obtained token in the request body.

## Files Modified

### 1. `src/lib/api.ts`
- **fetchAuthToken Method Updated**:
  - Added reCAPTCHA execution before API call.
  - Check if `window.grecaptcha` is available.
  - Call `grecaptcha.execute(siteKey, { action: "token" })` to get token.
  - Include `recaptchaToken` in POST body to `/api/token`.

- **Request Body Updated**:
  - Now sends `{ recaptchaToken, metadata }` instead of just `{ metadata }`.

### 2. `index.html`
- **Script Added**:
  - `<script src="https://www.google.com/recaptcha/api.js?render=6LdLa5ksAAAAAMmELly2HOBLsEz4iLfR2XiPDh5l" async defer></script>`
  - Loads reCAPTCHA v3 API with the site key.

### 3. `.env`
- Added `VITE_RECAPTCHA_SITE_KEY=6LdLa5ksAAAAAMmELly2HOBLsEz4iLfR2XiPDh5l`

## Files Added

### 4. `src/components/RecaptchaTokenDemo.tsx`
- Demo component to test the flow.
- Button that calls `apiService.fetchAuthToken("demo-metadata")`.
- Alerts success or error.

## Flow
1. User triggers token request (e.g., via demo button).
2. Frontend executes reCAPTCHA to get token.
3. Sends POST to `/api/token` with `recaptchaToken`.
4. Backend verifies and returns token or error.

## Dependencies
- `axios` (already present)
- Google reCAPTCHA script loaded via HTML.

## Testing
- Use the demo component to test pass/fail.
- Check browser console for `grecaptcha` availability.
- Modify backend threshold for forced fails.</content>
<parameter name="filePath">/Users/digpal/Desktop/oan_repo/bharat-oan-api/docs/recaptcha_backend_implementation.md