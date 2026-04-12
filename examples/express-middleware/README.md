# Express Middleware Example

Error handler middleware for Express.js applications.

## Setup

1. Install the package: `npm install gh-issue-tracker`
2. Set environment variables:

| Variable | Required | Description |
|----------|----------|-------------|
| `GITHUB_TOKEN` | Yes | GitHub PAT with Issues read/write permission |
| `GITHUB_REPO` | Yes | Target repository, e.g. `myorg/myapp` |
| `NODE_ENV` | No | Environment name (defaults to `"development"`) |

3. Initialize and use the middleware:

```ts
import express from 'express'
import { initErrorTracker, errorHandler } from './error-handler'

const app = express()

// Initialize error tracker at startup
initErrorTracker()

// Your routes...
app.get('/', (req, res) => { /* ... */ })

// Error handler MUST be the last middleware
app.use(errorHandler)

app.listen(3000)
```

## Notes

- The error handler must be registered **after** all other routes and middleware.
- In a long-running server, `flush()` ensures the error is reported before the response, but the GitHub API call would complete eventually even without it.
- For serverless Express (e.g., AWS Lambda), always `await flush()` before the function returns.
