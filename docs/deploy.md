# Deploying

Two halves, because they want different things. The PWA is static files and
belongs on a CDN; the API is a CPU-bound Python service and needs a container.

```
vercel.app   static PWA, free
    |
    |  rewrite /api/*  ->  no CORS, no base-URL switch in the client
    v
Cloud Run    FastAPI + prep/, scales to zero
```

The client always calls `/api/...` relative. In development Vite proxies that to
127.0.0.1:8141; in production Vercel rewrites it to Cloud Run. The browser only
ever sees one origin either way, so **CORS never applies in production** -- the
allowlist in `api/main.py` is for local development and for anyone pointing a
different front end at the API.

## Why not Vercel for the API

Three reasons, worst first. It is not a size problem you can trim your way out
of, and §4 called it before any of this was written: *"containers on Fly.io or
Railway; workers need real CPU, not edge functions."*

1. **State.** The flow spans three requests -- upload, prepare, download -- with
   the job on disk between them. Serverless functions are ephemeral and share no
   filesystem, so the job would be gone before the second call.
2. **Size.** ~300 MB of runtime dependencies against a 250 MB function limit.
   scipy alone is 115 MB.
3. **Time.** The orientation solver takes ~9 s on a 20k-face mesh.

## Why not Fly.io

No free tier since October 2024 -- new accounts get a 2-VM-hour trial, then
usage billing from about $5/month. The legacy free allowance was 256 MB VMs,
which would not run scipy anyway.

Cloud Run's always-free tier does fit: 2M requests, 180,000 vCPU-seconds and
360,000 GiB-seconds a month in us-central1 / us-east1 / us-west1, and it does
not expire. At roughly five seconds of work per job that is thousands of
prepares a month at nothing.

## The API, on Cloud Run

Needs `gcloud` and a project with billing enabled. Cloud Build compiles the
image, so Docker is not needed locally.

```bash
gcloud auth login
gcloud config set project YOUR_PROJECT_ID
gcloud services enable run.googleapis.com cloudbuild.googleapis.com

gcloud run deploy print-prep-api \
  --source . \
  --region us-central1 \
  --allow-unauthenticated \
  --memory 2Gi \
  --cpu 2 \
  --timeout 300 \
  --max-instances 4 \
  --set-env-vars JOBS_ROOT=/tmp/jobs
```

`--region` must be one of the three free-tier regions or the free allowance does
not apply. 2 GiB because scipy plus a dense mesh will exceed 512 MB and the
failure mode is a killed instance rather than a useful error.

Cloud Run prints a URL. Put it in `vercel.json`, replacing
`PRINT_PREP_API_URL` -- host only, no scheme, no trailing slash.

## The PWA, on Vercel

```bash
vercel --prod
```

Vercel auto-deploys on push once the project is linked, so after the first
deploy this is only needed to force one.

## What is not solved

**Jobs do not survive an instance recycling.** Cloud Run's filesystem is a
tmpfs, so a job lives as long as the instance does. With the six-hour sweep that
is usually longer than anyone needs, but someone mid-flow when an instance goes
away has to upload again. The fix is a bucket, not a bigger disk -- and §7 wants
artifacts kept anyway so re-printing at a new size needs no re-upload, so that
is the same piece of work.

**Rate limits are per-instance.** `api/limits.py` holds them in memory, so with
`--max-instances 4` the effective limit is four times the number in the file. A
shared limiter needs Redis. Sized generously enough that this does not matter
yet; it will if the service gets popular.

**Cold starts.** Scaling to zero means the first request after an idle period
waits for a ~1 GB image to start. The PWA being on Vercel is what keeps this
from being the first thing a visitor sees -- the app shell is instant, and only
the first upload pays.

## Wiring the two together

`vercel.json` ships **without** the `/api` rewrite, because a rewrite to a host
that does not exist yet fails the build. Once Cloud Run has printed a URL, add
it as the *first* rewrite -- before the SPA fallback, which is a catch-all and
would otherwise swallow `/api` and serve the app shell instead:

```json
"rewrites": [
  { "source": "/api/:path*", "destination": "https://YOUR-SERVICE.run.app/api/:path*" },
  { "source": "/(.*)", "destination": "/index.html" }
]
```

Order matters and the failure is quiet: with the fallback first, every API call
returns 200 and a page of HTML, and the client fails trying to parse it as JSON.
