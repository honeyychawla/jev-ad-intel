"""Every state a search (run) and an ad move through, in one place.

The server enforces these transitions, the page reads them from /api/config, and
GET /api/runs/{id} reports them, so people, the UI and agents all see the same thing.

Run lifecycle
-------------
    starting ──► scraping ──► analysing ──► done
        │            │             │
        └────────────┴─────────────┴──► stopped   (you pressed Stop; keeps what finished)
                                   └──► failed    (setup or scrape error; keeps what finished)

    interrupted: derived when a saved run never reached a final state because the
    server exited mid-run. It is never written by a live run.

Per-ad lifecycle (inside scraping / analysing)
----------------------------------------------
    pulled ─► ad read by Jev (row with lp_status "pending", sent as a partial)
           ─► landing page resolved ─► complete (row with a final lp_status)
    or     ─► error (Jev failed or didn't answer in time)

lp_status values are listed in LP_STATUS below.
"""

from enum import Enum


class RunState(str, Enum):
    STARTING = "starting"        # created, nothing fetched yet
    SCRAPING = "scraping"        # pulling ads (Apify, or ads reused from a recent search); each is analysed on arrival
    ANALYSING = "analysing"      # every ad pulled; waiting for Jev and landing pages to finish
    DONE = "done"
    STOPPED = "stopped"
    FAILED = "failed"
    INTERRUPTED = "interrupted"


TERMINAL = frozenset({RunState.DONE, RunState.STOPPED, RunState.FAILED, RunState.INTERRUPTED})

TRANSITIONS: dict[RunState, frozenset[RunState]] = {
    RunState.STARTING: frozenset({RunState.SCRAPING, RunState.STOPPED, RunState.FAILED}),
    RunState.SCRAPING: frozenset({RunState.ANALYSING, RunState.STOPPED, RunState.FAILED}),
    RunState.ANALYSING: frozenset({RunState.DONE, RunState.STOPPED, RunState.FAILED}),
}


class InvalidTransition(RuntimeError):
    pass


def check_transition(current: RunState, new: RunState) -> None:
    if new not in TRANSITIONS.get(current, frozenset()):
        raise InvalidTransition(f"run cannot go from {current.value} to {new.value}")


def resolve_saved(status: str | None, is_live_in_memory: bool) -> RunState:
    """State of a run read back from disk. A non-final state with no live run behind it
    means the server exited mid-run."""
    try:
        state = RunState(status)
    except ValueError:
        return RunState.INTERRUPTED
    if state not in TERMINAL and not is_live_in_memory:
        return RunState.INTERRUPTED
    return state


# What happened to an ad's landing page. Short labels are what the UI shows.
LP_STATUS: dict[str, str] = {
    "pending": "checking page",               # lifecycle: Jev has read the ad, page still loading
    "ok": "page read",                        # page text read; Jev judged the match
    "no_url": "no link",
    "not_a_web_page": "not a web page",       # WhatsApp, Messenger, app store, Facebook… (see lp_kind)
    "blocked": "page blocked",                # bot wall, even in a real browser
    "too_little_text": "no readable text",
    "error": "didn't load",
    "catalog": "catalog ad",                  # DPA: each viewer lands on a different product page
    "jev_error": "jev error",                 # page read, but Jev failed to judge it
    "timeout": "page too slow to load",       # run finished before the page loaded
    "stopped": "stopped before the page loaded",
    "interrupted": "app closed before the page loaded",
}
