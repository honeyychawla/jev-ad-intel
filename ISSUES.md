# Known issues

No open issues.

Every bug found while making the app's state machines explicit (16 Nov 2026) was scored
**frequency (1-10) × severity (1-10)**, and all of them are now fixed and tested.

| Bug | Freq | Sev | Score |
|---|---|---|---|
| Stop did nothing once scraping had finished, or on searches reusing recent ads | 4 | 5 | 20 |
| A search that found no ads, or whose scraper failed, showed an empty "done" dashboard with no explanation | 4 | 5 | 20 |
| Runs never saved in a final state (app restarted mid-search, missing key) reopened as "Live" forever | 3 | 6 | 18 |
| Landing-page cache ignored all query params (`?program=germany` vs `?program=canada` judged as one page) | 2 | 4 | 8 |
| Every saved run's title said "…, live" even when finished | 7 | 1 | 7 |
| A dropped live connection replayed the whole event history (duplicates, summary reopened) | 2 | 3 | 6 |
| A new search left the previous one running in the background; it is now stopped, keeping what Jev had read | 2 | 2 | 4 |
| A crash mid-search lost that search's rows; progress is now saved every 3 s while a search runs | 1 | 4 | 4 |
| The saved-searches list read every run's rows on each window focus; it now reads only each run's meta file | 2 | 2 | 4 |
| An unexpected error inside one ad dropped it silently; it is now recorded as an error row | 2 | 2 | 4 |
| A finished search with zero ads still said "Waiting for the first ad…" | 2 | 2 | 4 |
| Switching runs within about 1 s of a run finishing could open the summary over the new run | 1 | 3 | 3 |
| Finished runs stayed in memory until restart; they are now released 5 min after finishing | 1 | 2 | 2 |
| Found while testing: if building the end-of-run summary failed, the run never reached a final state; the summary now tolerates missing fields and can't block finishing | 1 | 6 | 6 |
