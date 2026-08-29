"""Read the usage numbers back out of Vercel Web Analytics.

The browser cannot ask Vercel for these itself. The Analytics API wants a
bearer token -- which must not be in a page -- and does not answer cross-origin
requests anyway, so something server-side has to stand in the middle. This is
that, and nothing else: it holds the token, forwards a fixed set of queries, and
reshapes the answers. There is no store here and no state; Vercel is the
database.

**It lives here rather than as a Vercel function on purpose.** A function would
have to sit in a top-level `api/` directory, which is this one -- the FastAPI
app -- and the collision is not worth having. `/api/*` is already rewritten
through to this service in production, so the dashboard reaches it by the same
path as everything else and no CORS applies.

Two things it deliberately does not do:

- **It is shut unless a key is set.** No INSIGHTS_KEY in the environment and
  every request is refused. Open-by-default would publish where the traffic
  comes from to anyone who guessed the path, and "nobody will guess it" is not
  an access control.
- **It never fails as a whole.** Seven queries go upstream and any one of them
  can be refused -- a dimension Vercel does not offer on that dataset, a plan
  limit, a project with analytics switched off. Each is reported on its own, so
  the dashboard draws what it has instead of showing one error where the numbers
  should be.

Configuration, all from the environment:

    INSIGHTS_KEY       the shared secret the dashboard sends. No key, no service.
    VERCEL_TOKEN       https://vercel.com/account/tokens
    VERCEL_PROJECT_ID  prj_... -- in .vercel/project.json
    VERCEL_TEAM_ID     team_... -- likewise, as orgId
"""

from __future__ import annotations

import asyncio
import json
import os
import secrets
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Header, HTTPException

# stdlib rather than httpx or the Vercel SDK. requirements-api.txt is explicit
# that the container installs runtime dependencies only, and one GET does not
# justify adding a dependency to the image that serves the mesh work.
API = "https://api.vercel.com/v1/query/web-analytics"
TIMEOUT = 20

router = APIRouter()


@dataclass(frozen=True)
class Query:
    """One question for Vercel, and the name the dashboard knows it by."""
    name: str
    dataset: str                    # "visits" or "events"
    by: tuple[str, ...] = ()        # empty means count rather than aggregate
    limit: int = 20


# The seven. Between them: how many came, when, what they landed on, where from,
# which campaign brought them, and how far they got.
QUERIES = (
    Query("totals", "visits"),
    Query("daily", "visits", ("day",), limit=100),
    Query("pages", "visits", ("requestPath",)),
    Query("referrers", "visits", ("referrerHostname",)),
    Query("utmSource", "visits", ("utmSource",)),
    Query("utmCampaign", "visits", ("utmCampaign",)),
    Query("events", "events", ("eventName",)),
)


def _settings() -> dict[str, str]:
    missing = [name for name in ("VERCEL_TOKEN", "VERCEL_PROJECT_ID")
               if not os.environ.get(name)]
    if missing:
        raise HTTPException(
            503,
            "This service has no Vercel credentials. Set "
            + " and ".join(missing) + " on the API and redeploy.")
    return {
        "token": os.environ["VERCEL_TOKEN"],
        "projectId": os.environ["VERCEL_PROJECT_ID"],
        "teamId": os.environ.get("VERCEL_TEAM_ID", ""),
    }


def _fetch(query: Query, since: str, until: str, settings: dict) -> dict:
    """One upstream call. Blocking -- run it off the loop."""
    params = {
        "projectId": settings["projectId"],
        "since": since,
        "until": until,
    }
    if settings["teamId"]:
        params["teamId"] = settings["teamId"]
    if query.by:
        params["limit"] = str(query.limit)
        # Repeated rather than comma-joined: `by` is an array upstream, and a
        # comma-joined value comes back as one dimension named "a,b".
        pairs = list(params.items()) + [("by", dimension) for dimension in query.by]
    else:
        pairs = list(params.items())

    shape = "aggregate" if query.by else "count"
    url = f"{API}/{query.dataset}/{shape}?{urllib.parse.urlencode(pairs)}"
    request = urllib.request.Request(
        url, headers={"Authorization": f"Bearer {settings['token']}"})
    with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
        return json.loads(response.read().decode("utf-8"))


def _rows(payload: dict) -> list[dict]:
    """Normalise an aggregate response into {label, count, visitors}.

    The dimension's key in each row is not a fixed name -- it follows what was
    grouped by, and for a nested group like eventData/plan it is the prefix
    rather than the whole path. So the two counts are lifted out by name and
    whatever single key is left is the label.
    """
    out = []
    for row in payload.get("data") or []:
        if not isinstance(row, dict):
            continue
        count = row.get("count")
        visitors = row.get("visitors")
        label = next((str(value) for key, value in row.items()
                      if key not in ("count", "visitors")), "")
        out.append({
            "label": label or "(none)",
            "count": int(count or 0),
            "visitors": int(visitors or 0),
        })
    out.sort(key=lambda r: (-r["visitors"], -r["count"], r["label"]))
    return out


def _reason(error: Exception) -> str:
    """Say what went wrong in a way that names the fix."""
    if isinstance(error, urllib.error.HTTPError):
        body = ""
        try:
            body = json.loads(error.read().decode("utf-8"))
            body = body.get("error", {}).get("message", "")
        except Exception:                       # noqa: BLE001 - see below
            # The one broad catch in this file, and it is around parsing an
            # error body that has already failed. Anything thrown here would
            # replace a real upstream error with a parsing one.
            body = ""
        if error.code == 404:
            return ("Web Analytics is not switched on for this project. "
                    "Vercel dashboard -> the project -> Analytics -> Enable.")
        if error.code in (401, 403):
            return "Vercel refused the token. Check VERCEL_TOKEN and its scope."
        return f"Vercel said {error.code}. {body}".strip()
    if isinstance(error, urllib.error.URLError):
        return f"Could not reach Vercel: {error.reason}"
    return str(error)


@router.get("/api/insights")
async def insights(days: int = 30, x_insights_key: str = Header(default="")):
    """Everything the dashboard draws, in one call."""
    expected = os.environ.get("INSIGHTS_KEY", "")
    if not expected:
        raise HTTPException(
            503,
            "The usage numbers are switched off. Set INSIGHTS_KEY on the API "
            "to turn them on.")
    if not secrets.compare_digest(x_insights_key, expected):
        raise HTTPException(401, "That key is not right.")

    days = max(1, min(int(days), 365))
    settings = _settings()
    now = datetime.now(timezone.utc)
    since = (now - timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%S.000Z")
    until = now.strftime("%Y-%m-%dT%H:%M:%S.000Z")

    async def run(query: Query):
        try:
            return query, await asyncio.to_thread(
                _fetch, query, since, until, settings), None
        except (urllib.error.URLError, ValueError, OSError) as error:
            return query, None, _reason(error)

    answers = await asyncio.gather(*(run(q) for q in QUERIES))

    result: dict = {
        "days": days, "since": since, "until": until,
        "unavailable": {},
    }
    for query, payload, problem in answers:
        if problem is not None:
            result["unavailable"][query.name] = problem
            result[query.name] = [] if query.by else {}
            continue
        data = payload.get("data")
        if query.by:
            result[query.name] = _rows(payload)
        else:
            # The count shape is a single object, not rows.
            data = data if isinstance(data, dict) else {}
            result[query.name] = {
                "visitors": int(data.get("visitors") or 0),
                "pageviews": int(data.get("pageviews") or 0),
            }
    return result
