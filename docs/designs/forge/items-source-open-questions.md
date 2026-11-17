# `items-source@1`: what the interface leaves undefined

Found while writing its shared test (slice S3). A real source that reaches the network and costs money would trip on each. None is decided; the interface is unchanged.

1. **A cursor the source did not make.** Refused, or start again from the beginning? The interface does not say; the shared test accepts either.
2. **`pageCostUsd`.** What a full page costs, or the most a page can cost? The shared test checks only "never more", and the total the mode's test states.
3. **`limit`** is "the most items one sync fetches over all its pages", but a source sees one page at a time. Today the caller lowers `limit` before each fetch.
4. **Must a field in `nativeFields` be applied exactly?** The shared test asks only that a native field leaves something out and never drops a match.
5. **Oldest first** across pages, or only within a page? The shared test checks the whole walk.
6. **May the cursor on an empty page be null?** If so, a later sync would start again.
7. **A local recorded service.** Network grants are fixed in a mode's manifest. Can a real source's test be granted a made-up or recorded service on this machine, on any port? This decides whether a real source can run the shared test at all.
8. **May an empty page cost something,** for a source that charges per request?
