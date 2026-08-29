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

**On this machine, gcloud needs its own Python pointed out to it.** `gcloud` is
a Python program, and the bare name `python` here is a Microsoft Store stub that
only ever prints "Python was not found" -- so every gcloud command fails with
that instead of anything about gcloud. The SDK ships a Python for exactly this
reason; name it:

```bash
export CLOUDSDK_PYTHON="/c/Users/jjudi/AppData/Local/Google/Cloud SDK/google-cloud-sdk/platform/bundledpython/python.exe"
```

In PowerShell:

```powershell
$env:CLOUDSDK_PYTHON = "$env:LOCALAPPDATA\Google\Cloud SDK\google-cloud-sdk\platformundledpython\python.exe"
```

The installer puts gcloud on the persistent user PATH, so a **new** terminal
finds it; one opened before the install will not.

**Billing enabled is not the same as being billed.** Cloud Run's free allowance
-- 2M requests, 180,000 vCPU-seconds, 360,000 GiB-seconds a month -- is real and
does not expire, but Google will not let you enable the API without a payment
method on the account. At 2 vCPU the CPU allowance binds first: 90,000 instance-
seconds, or roughly 8,000 models a month, at nothing. There is no hard cap by
default, so set a budget alert; past the allowance it runs about $0.0006 per
model, which is cheap but not zero.

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


---

## Live, and what the first deploy measured

* PWA: **https://bambu-print-prep.vercel.app**
* API: **https://print-prep-api-23515929262.us-central1.run.app** (project
  `bambu-print-prep`, us-central1)

The file the deployed service produces was checked against the corpus control:
15 members, identical to Bambu Studio's own container, 487 settings, prime tower
values correct, and printer-specific filament (`@BBL A1M` for an A1 mini, not
the X1C profile the OrcaSlicer tree would have picked). The vendored profiles
shipped correctly.

### Upload latency is the problem, and §4 called it

Measured through the live stack, warm, not cold starts:

| Model | Faces | Time |
|---|---|---|
| dragon.stl | 140 | 0.95 s |
| sphere | 20,480 | **19.4 s** |
| sphere | 327,680 | **27 s** |

The orientation solver dominates, and Cloud Run's shared vCPUs are about half
the speed of this development machine -- 9 s locally becomes 19 s there.

**The upload endpoint is synchronous, and at these times that is not tenable.**
§4 says so directly: *"Why a job queue: slicing is 5-90 s and CPU-bound. The
request must not block. The PWA polls or subscribes for status."* It was built
synchronously anyway, and production immediately produced the failure that
predicts: three uploads in quick succession returned a **502** from Vercel's
proxy on the third, because `MAX_CONCURRENT_JOBS` resolves to 1 on a 2-vCPU
instance -- `(os.cpu_count() or 2) // 2` -- so they serialised and the last one
waited past the gateway's patience. Re-run singly, the same file succeeds.

Two things follow, in order:

1. **`POST /api/jobs` should return 202 and a job id immediately**, with the
   browser polling for the report and the orientations. That removes the
   gateway timeout as a class of failure and lets the UI say what is happening,
   instead of a file picker that appears frozen for twenty seconds.
2. **The solver is worth profiling.** 19 s for 20k faces is slow for something
   that already works on a decimated proxy, and every second of it is charged
   twice -- once to the user's patience and once to the free-tier allowance.

Neither is a reason not to ship what is there: a model of ordinary size prepares
in about a second. Both are the reason the next person should not add features
before fixing this.

### Vercel's proxy does not cap uploads at 4.5 MB

A 16 MB upload passes through the rewrite intact. The documented 4.5 MB limit
applies to Vercel serverless functions, not to rewrites that proxy to an
external origin, so `MAX_UPLOAD_BYTES` in `api/limits.py` remains the real
ceiling.


---

## Background work on Cloud Run needs CPU always allocated

This one is not obvious and cost a deploy to find.

`POST /api/jobs` answers 202 and finishes the examination behind the response.
On Cloud Run that silently does not work: **CPU is throttled to near zero
outside request processing**, so a task scheduled after the response gets no
cycles. Jobs sat at `working` indefinitely. Eighty rapid polls did not advance
one -- a poll allocates CPU only for its own few milliseconds, and the solver
needs nineteen seconds of it.

The synchronous version worked precisely *because* the work happened during the
request. Making it asynchronous moved it outside the window where the container
is allowed to run.

`--no-cpu-throttling` fixes it, and is how the service is deployed:

```bash
gcloud run deploy print-prep-api --source . --region us-central1   --allow-unauthenticated --memory 2Gi --cpu 2 --timeout 300   --max-instances 1 --no-cpu-throttling   --set-env-vars JOBS_ROOT=/tmp/jobs
```

**It changes the billing model, and therefore the free-tier maths.** With CPU
always allocated you are charged for the instance's whole lifetime rather than
for request time, and Cloud Run keeps an idle instance alive for a while before
shutting it down. So the unit of consumption stops being "a model prepared" and
becomes "a period of activity". The earlier estimate of thousands of models a
month assumed request-time billing and no longer holds; the honest figure is on
the order of a hundred distinct usage sessions a month inside the free
allowance, with any number of models inside each. The $1 budget alert is the
backstop, and it is set.

**If that ever binds, the fix is Cloud Tasks rather than a bigger allowance.**
Enqueue a task that calls back into the service as an ordinary request: the work
then happens *during* a request, CPU is allocated for exactly as long as it
runs, throttling can go back on, and billing returns to per-model. It is the
idiomatic Cloud Run answer to background work and it is more moving parts, which
is why it is not here yet.

## `--max-instances 1`, and why it is not just thrift

Jobs live on the instance's tmpfs. With more than one instance, an upload
handled by A and a poll handled by B gives a 404 for a job that is fine --
and polling makes that far more likely to happen than the old single
request-response did. One instance makes the store coherent. The mesh semaphore
already serialises the CPU-bound part to one job at a time on a 2-vCPU box, so
little is given up.

The queue is visible and honest: three uploads at once completed at 36s, 41s
and 57s. Slow, but every one succeeded and each upload answered immediately --
where the synchronous version returned a 502 on the third.


---

## Two things real devices found that this machine could not

### `accept` on a file input makes an iPad refuse every file

The input carried `accept=".stl,.obj,.3mf,.glb,.ply"`, which is correct-looking
and, on iOS, catastrophic. iOS resolves `accept` against uniform type
identifiers, and none of those extensions has one registered unless some
installed app claims it. The result is not a narrower list: **Files greys out
everything and no file can be chosen at all.** On the one device this product
exists for, `accept=".stl"` means "you may not upload an STL".

The attribute is gone. `prep.ingest` already refuses what it cannot read with a
sentence written for a person, which is a better place to fail than a picker
that silently offers nothing.

Worth remembering as a class: **a filter that is merely wrong on desktop can be
total on mobile**, and nothing on a Windows dev machine will ever show it.

### The model rendered as a black silhouette

trimesh exports GLB with `POSITION` and nothing else -- no `NORMAL` attribute,
confirmed by reading the glTF JSON chunk. A `MeshStandardMaterial` with no
normals has nothing to shade against, so every surface renders flat unlit black.
The model appears as a solid silhouette, which reads as "the colour is wrong"
rather than "the lighting is missing".

`computeVertexNormals()` on load fixes it. Measured into an offscreen render
target, which works even where the preview pane cannot composite:

| | lit pixels | distinct shades |
|---|---|---|
| before | 0 | 0 |
| after | 2103 | 14 |

**This was verified numerically and never looked at**, which is how it shipped.
The browser checks asserted bounding boxes and sizes -- all of which were
correct -- while the picture was black the entire time. Sampling geometry is not
the same as seeing the render, and this project's rule about measuring rather
than assuming has a corollary: measure the thing the user actually looks at.

## The usage numbers, and what has to be switched on

`/dashboard` answers one question -- is the advertising working -- from Vercel
Web Analytics. Nothing new is stored: Vercel counts, `api/insights.py` reads
back, and the page draws. There is no database and no events endpoint of our
own, which is the point. Standing one up would have put a server back under
`/local`, which is the one page whose whole argument is that it does not have
one.

**None of it does anything until four things are set, and one of them is a
checkbox nobody can set from here.**

1. **Switch Web Analytics on for the project.** Vercel dashboard -> the project
   -> Analytics -> Enable. Until this is done every query comes back `404 Web
   Analytics not found`, and the dashboard says so in those words rather than
   showing an empty chart.
2. **Make a token** at https://vercel.com/account/tokens, scoped to the team
   that owns the project.
3. **Give the function the token and a key of your own choosing**, as
   environment variables on the Vercel project (Settings -> Environment
   Variables, Production). `INSIGHTS_KEY` is what the dashboard asks you for;
   without it the endpoint refuses every request, including one that sends no
   key at all. It is not open by default and should not be made so -- it reports
   where the traffic comes from.

```powershell
vercel env add INSIGHTS_KEY production        # then paste a secret you pick
vercel env add VERCEL_TOKEN production        # then paste the token from step 2
vercel env add VERCEL_PROJECT_ID production   # prj_qTWpMAa2mO6XgECJhwFDpPIK5QlR
vercel env add VERCEL_TEAM_ID production      # team_2VsnfArdtbvj58Oyg13T4Sir
```

4. **Redeploy**, because environment variables are read at request time but only
   attach to a new deployment. Pushing anything does it, or `vercel --prod`.

### The catch-all rewrite has to let `_vercel` and `api` through

`vercel.json` used to end with `"/(.*)" -> "/index.html"`. Two things need to
get past it. The counting script is served by the platform from
`/_vercel/insights/script.js`, and the dashboard's function is at
`/api/insights`. A catch-all that broad answers either with a page of HTML --
the same shape of bug as the old API rewrite having to stay ahead of the SPA
fallback, and just as silent: the script tag loads, parses as HTML, and simply
never counts anything. The source is now `"/((?!_vercel/|api/).*)"`.

### Vercel will try to build the FastAPI app as serverless functions

Vercel turns every file in a top-level `api/` directory into a function. That
directory is also the Python API, so without `.vercelignore` excluding
`api/*.py` the build attempts a serverless function out of `main.py` -- on an
image with no trimesh, no manifold3d, no scikit-image. Only `api/insights.js` is
meant to deploy.

### What the numbers cannot tell you

The funnel stops at "saved the file". MakerWorld, Bambu Handy and the printer
are all past the edge of the browser, and no amount of instrumenting this app
reaches them. Milestone 6 -- watching one person do the whole thing -- is still
the only way to learn where people actually stall, and a dashboard is not a
substitute for it. What this *can* do is say which posted link brought people
who got as far as a file, which is the half of the question that is measurable.
