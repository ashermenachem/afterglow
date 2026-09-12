# Security

Do not include API keys or personal data in public issues. Use GitHub's **Security → Report a vulnerability** on this repository for sensitive reports.

API keys belong in a local `.env` file or encrypted Vercel environment variables. They must never use a `VITE_` prefix, be sent to the browser, or be committed. `.env.example` contains placeholders only.

`npm run check:secrets` checks tracked files for private configuration and common credentials, and checks against local provider keys when available. It is a safeguard, not a guarantee that every secret format can be detected.

Public hosting includes CDN response caching, a bounded server cache, upstream concurrency limits and a per-instance request limiter. These do not replace provider quotas or a distributed abuse-control service. Rotate credentials at the provider immediately if you disclose them elsewhere.
