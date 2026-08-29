"""The usage numbers, and the two ways they could go wrong quietly.

This endpoint holds a Vercel token and reports where the traffic comes from, so
the interesting tests are not about shapes of JSON:

* **Shut unless switched on.** No INSIGHTS_KEY and it must refuse -- including
  refusing a request that sends no key at all, which is the one an accidental
  deploy would get hit with first.
* **Partly-working is a real answer.** Seven queries go upstream and any one can
  be refused on its own: a dimension Vercel does not offer for that dataset, a
  plan limit, analytics switched off. If one failure took the whole call down,
  the dashboard would show an error on the day a single dimension changed name.

The upstream call is stubbed throughout. Nothing here reaches Vercel, and
nothing here needs a token.
"""

from __future__ import annotations

import urllib.error

import pytest
from fastapi.testclient import TestClient

from api import insights
from api.main import app

client = TestClient(app)

CREDENTIALS = {
    "INSIGHTS_KEY": "let-me-in",
    "VERCEL_TOKEN": "tok",
    "VERCEL_PROJECT_ID": "prj_test",
    "VERCEL_TEAM_ID": "team_test",
}


@pytest.fixture
def configured(monkeypatch):
    for name, value in CREDENTIALS.items():
        monkeypatch.setenv(name, value)


@pytest.fixture(autouse=True)
def no_credentials(monkeypatch):
    """Start every test with nothing set, so each one says what it needs."""
    for name in CREDENTIALS:
        monkeypatch.delenv(name, raising=False)


def stub(monkeypatch, answers):
    """Answer each query by name, or raise what the value is if it is an error."""
    def fake(query, since, until, settings):
        answer = answers[query.name]
        if isinstance(answer, Exception):
            raise answer
        return answer
    monkeypatch.setattr(insights, "_fetch", fake)


def rows(*pairs, key="referrerHostname"):
    return {"data": [{key: label, "count": count, "visitors": count}
                     for label, count in pairs]}


# --- shut unless switched on -------------------------------------------------

def test_it_refuses_when_no_key_is_configured():
    assert client.get("/api/insights").status_code == 503


def test_a_configured_key_still_refuses_the_wrong_one(configured):
    assert client.get(
        "/api/insights", headers={"X-Insights-Key": "guess"}).status_code == 401


def test_it_refuses_an_empty_key_against_a_configured_one(configured):
    """The request an accidental deploy gets hit with first."""
    assert client.get("/api/insights").status_code == 401
    assert client.get(
        "/api/insights", headers={"X-Insights-Key": ""}).status_code == 401


def test_it_says_what_is_missing_when_vercel_is_not_configured(monkeypatch):
    monkeypatch.setenv("INSIGHTS_KEY", "let-me-in")
    answer = client.get("/api/insights", headers={"X-Insights-Key": "let-me-in"})
    assert answer.status_code == 503
    assert "VERCEL_TOKEN" in answer.json()["detail"]


# --- what it hands back ------------------------------------------------------

def test_it_reshapes_every_query_into_one_answer(configured, monkeypatch):
    stub(monkeypatch, {
        "totals": {"data": {"visitors": 40, "pageviews": 91}},
        "daily": rows(("2026-08-27", 10), key="day"),
        "pages": rows(("/local", 30), ("/", 10), key="requestPath"),
        "referrers": rows(("reddit.com", 22), ("google.com", 8)),
        "utmSource": rows(("reddit", 22), key="utmSource"),
        "utmCampaign": rows(("launch", 22), key="utmCampaign"),
        "events": rows(("model opened", 12), ("file made", 5), key="eventName"),
    })
    answer = client.get(
        "/api/insights", headers={"X-Insights-Key": "let-me-in"}).json()

    assert answer["totals"] == {"visitors": 40, "pageviews": 91}
    assert answer["unavailable"] == {}
    assert [r["label"] for r in answer["referrers"]] == ["reddit.com", "google.com"]
    assert answer["events"][0] == {"label": "model opened", "count": 12, "visitors": 12}


def test_rows_come_back_biggest_first_whatever_order_vercel_used(
        configured, monkeypatch):
    """The dashboard draws them in order; sorting there would be a second place
    to get it wrong."""
    stub(monkeypatch, {
        "totals": {"data": {}},
        "daily": {"data": []},
        "pages": {"data": []},
        "referrers": rows(("small.com", 1), ("big.com", 99), ("mid.com", 40)),
        "utmSource": {"data": []},
        "utmCampaign": {"data": []},
        "events": {"data": []},
    })
    answer = client.get(
        "/api/insights", headers={"X-Insights-Key": "let-me-in"}).json()
    assert [r["label"] for r in answer["referrers"]] == [
        "big.com", "mid.com", "small.com"]


def test_a_row_with_no_referrer_is_named_rather_than_left_blank(
        configured, monkeypatch):
    """Direct traffic is the answer to "is the advertising working" too, and an
    empty label in that table reads as a bug."""
    stub(monkeypatch, {
        "totals": {"data": {}}, "daily": {"data": []}, "pages": {"data": []},
        "referrers": rows(("", 12)),
        "utmSource": {"data": []}, "utmCampaign": {"data": []},
        "events": {"data": []},
    })
    answer = client.get(
        "/api/insights", headers={"X-Insights-Key": "let-me-in"}).json()
    assert answer["referrers"][0]["label"] == "(none)"


# --- partly working is a real answer -----------------------------------------

def one_query_fails(error):
    ok = {"data": []}
    return {
        "totals": {"data": {"visitors": 5, "pageviews": 9}},
        "daily": ok, "pages": ok, "referrers": ok,
        "utmSource": ok, "utmCampaign": ok,
        "events": error,
    }


def test_one_refused_query_does_not_take_the_others_with_it(
        configured, monkeypatch):
    stub(monkeypatch, one_query_fails(
        urllib.error.HTTPError("u", 400, "Bad Request", {}, None)))
    answer = client.get(
        "/api/insights", headers={"X-Insights-Key": "let-me-in"})

    assert answer.status_code == 200
    body = answer.json()
    assert body["totals"] == {"visitors": 5, "pageviews": 9}
    assert body["events"] == []
    assert "events" in body["unavailable"]


def test_analytics_being_switched_off_says_how_to_switch_it_on(
        configured, monkeypatch):
    """A 404 here means one checkbox in the Vercel dashboard, and the message
    has to say so -- otherwise it reads as the endpoint being broken."""
    stub(monkeypatch, one_query_fails(
        urllib.error.HTTPError("u", 404, "Not Found", {}, None)))
    body = client.get(
        "/api/insights", headers={"X-Insights-Key": "let-me-in"}).json()
    assert "Analytics" in body["unavailable"]["events"]


def test_a_refused_token_is_not_reported_as_analytics_being_off(
        configured, monkeypatch):
    stub(monkeypatch, one_query_fails(
        urllib.error.HTTPError("u", 403, "Forbidden", {}, None)))
    body = client.get(
        "/api/insights", headers={"X-Insights-Key": "let-me-in"}).json()
    assert "VERCEL_TOKEN" in body["unavailable"]["events"]


def test_vercel_being_unreachable_is_reported_rather_than_raised(
        configured, monkeypatch):
    stub(monkeypatch, one_query_fails(urllib.error.URLError("no route")))
    answer = client.get(
        "/api/insights", headers={"X-Insights-Key": "let-me-in"})
    assert answer.status_code == 200
    assert "reach Vercel" in answer.json()["unavailable"]["events"]


# --- what goes upstream ------------------------------------------------------

def test_the_window_is_clamped_rather_than_trusted(configured, monkeypatch):
    """days comes off a query string, so it is user input even though only one
    user has the key."""
    seen = {}

    def fake(query, since, until, settings):
        seen["since"] = since
        return {"data": []}
    monkeypatch.setattr(insights, "_fetch", fake)

    for asked, most in ((100000, 365), (0, 1), (-5, 1)):
        answer = client.get(f"/api/insights?days={asked}",
                            headers={"X-Insights-Key": "let-me-in"})
        assert answer.json()["days"] == most


def test_each_dimension_is_sent_as_its_own_parameter(configured, monkeypatch):
    """Comma-joining `by` comes back as one dimension named "a,b" rather than
    two, and the rows silently stop meaning what they say."""
    urls = []

    class Fake:
        def __enter__(self):
            return self

        def __exit__(self, *_):
            return False

        def read(self):
            return b'{"data": []}'

    def fake_open(request, timeout=None):
        urls.append(request.full_url)
        return Fake()

    monkeypatch.setattr(insights.urllib.request, "urlopen", fake_open)
    client.get("/api/insights", headers={"X-Insights-Key": "let-me-in"})

    assert any("by=day" in url for url in urls)
    assert not any("by=day%2C" in url or "by=day," in url for url in urls)
    assert any("/visits/count?" in url for url in urls)
    assert any("/events/aggregate?" in url for url in urls)
