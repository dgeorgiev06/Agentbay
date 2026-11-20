# The home mode: a design note, version 2

Status: design, 2026-11-18. Not approved, not planned, not built. Version 2 of this note. It follows the owner's direction of 18 November, given after he read version 1. Words are used as `CONTEXT.md` defines them.

Read with: `docs/proposals/0023-home-mode.md` (the requirements of 2026-11-16), `docs/research/2026-11-16-home-records-by-address.md` (what public records hold), `docs/designs/pm-mode/design.md` section 2 (the form of a requirements file), `docs/plans/0024-forge-whole.yaml` (the form of a plan), `framework/practices.md`.

This note is not legal, tax, building or financial advice. Nor is anything the mode shows.

## The owner's direction

His words, 18 November: "I provide address. The home mode should get public data for the house. I upload plan and price. I tell you what I want to redesign. You sketch a 2d sketch and cost estimates based on publicly available data for the area."

So the flow is five steps:

1. The owner types the address of a house he is considering.
2. The mode gets public data for that house.
3. The owner uploads the floor plan and gives the asking price.
4. He says in words what he wants to redesign.
5. The mode gives a 2D sketch of the redesign, before and after, and a cost estimate that rests on public data for the area.

## What changed from version 1

- **Reversed.** Version 1 had a hard limit: no lookup by address at all. The owner now wants one. The mode now looks up public records for an address **he types**, after he approves a card. Proposal 0023 had asked for this too, so the conflict version 1 named is gone.
- **Changed.** Version 1 started from documents (listing text, disclosure, inspection). Version 2 starts from the address, the plan and the redesign. Reading documents moves out of the first versions.
- **Changed.** Version 1 put the sketch last ("design B, later"). It is now the centre. The room model of version 1's design B is the working model.
- **Kept.** No scraping. Estimates, not advice. The owner's own address and finances stay on the machine. A card before a model reads anything. The price book behind `price-book@1`, with grades and ranges. The BLS wage source. The list of turned-down cost sources.

## The hard limits

These hold in every version. A change to any of them is the owner's decision, in his own words, recorded in an ADR first.

1. **No scraping.** The mode never scrapes, crawls or automates a listing site or portal (Zillow, Redfin, Realtor.com, OneKey and other MLS front ends, county parcel viewers, town permit portals) or any site whose terms forbid automated access. It reaches a public source only through a documented API or a published download. Each source is named one by one in section 2, with its URL, publisher, terms as read, what it gives, how it is reached and its rate limits. A source whose terms could not be read is marked unverified and is not built until they are.
2. **Property, never people.** The mode looks up only an address the owner typed for a house he is considering. It keeps facts about the **property**: parcel, lot size, year built, building outline, assessed value, zoning, flood zone, permits where published. It never collects, stores or shows the name or any other detail of the current owner or occupants, even where a public record carries them. The fields dropped are listed in section 2.3. A test holds it (DOD-PS1-2 and DOD-NY1-2 in section 8).
3. **A card before anything leaves.** The address goes to a source only after the owner approves a card that names the source and shows exactly what is sent. Nothing about the owner's own address or finances leaves the machine otherwise. What a model reads (his words, the room model, later the plan image) is shown on a card first, as in version 1.
4. **Estimates, not advice.** Costs, values and anything structural are estimates to check with a licensed inspector, contractor, architect, engineer, lawyer or accountant. Every such output says so in a fixed sentence. A sketch is not a construction drawing and says so on its face.

### The fixed sentences

The mode prints these words exactly. A test holds each.

- Under every estimate: "Estimate only, not advice. Check it with a licensed contractor before you rely on it."
- Under an estimate with a line that touches a wall: "A wall may carry load. Have a licensed engineer or architect look first."
- On every sketch: "Sketch only. Not a construction drawing."
- Under public facts: "Public records, as published. They can be out of date. Check them with the town before you rely on them."

---

## 1. The flow as outcomes

**Conclusion.** Five outcomes, one per step of the flow, and a sixth for the privacy rule. Each has the refusals the owner asked for: no match, two matches, a source that is down, a plan the mode cannot read, a redesign the plan cannot hold. They are written as the requirements file the PM mode will check, `docs/requirements/home.yaml`.

The file is in the form of `docs/designs/pm-mode/design.md` section 2. It names no kind of proof. Every value is literal and made up; no real address is used. It is a draft: `decided` is empty and `signed` is added by the PM mode at sign-off.

```yaml
job: home
version: 1
title: The home mode looks up a house by address, holds its floor plan, sketches a redesign and estimates its cost
for: The owner, who is weighing houses to buy, renovate and sell.
asked:
  - by: owner
    on: 2026-11-18
    words: I provide address. The home mode should get public data for the house. I upload plan and price. I tell you what I want to redesign. You sketch a 2d sketch and cost estimates based on publicly available data for the area.
constraints:
  - No listing site, portal or site whose terms forbid automated access is fetched or automated.
  - The address goes to a source only after the owner approves a card naming the source and what is sent.
  - No name or other detail of a current owner or occupant is stored or shown.
  - Every estimate and sketch carries its fixed sentence.
outcomes:
  - id: O1
    says: The owner types an address and, after approving a card, sees the public facts of that one property, each with its source and date.
    from: [asked 1]
    conditions:
      - id: O1-C1
        path: works
        given: the address "12 Example Lane, Sampletown NY" and a geocoder that returns 1 match
        when: the owner runs look-up for house example-1 and answers send on the card
        then: the card listed "NYS Geocoder" and the text "12 Example Lane, Sampletown NY" as all that is sent, and a second card lists the point "42.00010, -73.90020" and the 4 sources that receive it
      - id: O1-C2
        path: works
        given: the second card of O1-C1, and sources that return year built 1952, lot 0.42 acres, total assessed value 210000, flood zone "X" and a building outline of 1,008 sq ft
        when: the owner answers send
        then: 'the facts list "year built 1952 (NYS parcel centroids, roll 2024)", "lot 0.42 acres", "assessed value $210,000", "flood zone X (FEMA NFHL)" and "outline 1,008 sq ft (NYS Building Footprints)"'
      - id: O1-C3
        path: refused
        given: the address "99 Nowhere Road, Sampletown NY" and a geocoder that returns 0 matches
        when: the owner runs look-up and answers send
        then: 'it is refused with a sentence that contains "No match for 99 Nowhere Road, Sampletown NY"'
        after: house example-1 holds 0 public facts and the run sent nothing to any source but the geocoder
      - id: O1-C4
        path: refused
        given: a geocoder that returns 2 matches, "12 Example Lane, Sampletown" and "12 Example Lane, Sampletown Village"
        when: the owner runs look-up and answers send
        then: 'a card shows both matches as the choices "match-1" and "match-2", and no request goes to a parcel, outline or flood source'
        after: once the owner answers match-2, the next card shows the point of "12 Example Lane, Sampletown Village" only
      - id: O1-C5
        path: refused
        given: the second card of O1-C1 approved and the flood source answering status 503
        when: the look-up runs
        then: 'the facts show "flood zone: not known; FEMA NFHL did not answer (503)" and the 4 other facts are kept'
        after: running look-up again for example-1 asks for the flood source only, on a card that lists 1 source
      - id: O1-C6
        path: refused
        given: the owner answers keep-local on the first card
        when: the run ends
        then: 'the run says "Nothing was sent" and 0 requests were made'
        after: house example-1 holds 0 public facts
  - id: O2
    says: The owner gives the asking price and the floor plan as typed rooms, and sees the plan drawn to scale.
    from: [asked 1]
    conditions:
      - id: O2-C1
        path: works
        given: house example-1
        when: the owner sets the asking price 389000
        then: 'the house shows "asking price $389,000 (given by you)"'
      - id: O2-C2
        path: works
        given: 'rooms.yaml for example-1 with an outline of 36 ft by 28 ft and the 5 rooms of section 5 of this note'
        when: the owner runs floor-in
        then: 'floor version 1 is stored and sketch-v1.svg shows 5 labelled rooms, among them "Kitchen 13 ft x 12 ft, 156 sq ft"'
      - id: O2-C3
        path: refused
        given: rooms.yaml where the kitchen runs from x 0 to 156 in and the dining room from x 144 to 300 in on the same rows
        when: the owner runs floor-in
        then: 'it is refused with a sentence that contains "kitchen and dining overlap by 12 in"'
        after: example-1 has 0 floor versions
      - id: O2-C4
        path: refused
        given: the file plan.png in homes/example-1 and a kit that cannot hand an image to a skill step
        when: the owner runs floor-in with plan.png
        then: 'it is refused with a sentence that contains "cannot read a plan image yet; type the rooms in rooms.yaml"'
        after: 'the file "homes/example-1/rooms.yaml" exists as a blank form and 0 skill tasks were created'
      - id: O2-C5
        path: refused
        given: house example-1
        when: the owner sets the asking price "about 390k"
        then: 'it is refused with a sentence that contains "a whole number of dollars, like 389000"'
        after: 'the house shows "asking price: not given"'
  - id: O3
    says: The owner says in words what to redesign and sees the plan before and after, side by side, once he accepts the change.
    from: [asked 1]
    conditions:
      - id: O3-C1
        path: works
        given: floor version 1 of section 5
        when: the owner asks to redesign with the words "Open the kitchen to the dining room", approves the words card and answers accept
        then: 'floor version 2 has the room "Kitchen and dining" of 300 sq ft, 4 rooms in all, and sketch-v2.svg shows version 1 and version 2 side by side with the removed wall dashed'
      - id: O3-C2
        path: works
        given: any sketch
        when: it is drawn
        then: it shows a scale bar of 10 ft and the line "Sketch only. Not a construction drawing."
      - id: O3-C3
        path: refused
        given: floor version 1, where the kitchen's west wall is on the outline
        when: the owner asks to "move the kitchen's west wall out 4 ft"
        then: 'the change is refused with a sentence that contains "4 ft outside the house outline; an addition is not in this version"'
        after: example-1 has floor version 1 only
      - id: O3-C4
        path: refused
        given: the words card for "Open the kitchen to the dining room"
        when: the owner answers keep-local
        then: 0 skill tasks are created
        after: example-1 has floor version 1 only
  - id: O4
    says: The owner sees the cost of a redesign as a range, line by line, each line with its source and grade, the unpriced lines counted.
    from: [asked 1]
    conditions:
      - id: O4-C1
        path: works
        given: floor versions 1 and 2 of O3-C1, and the price book of section 6
        when: the owner asks for the estimate
        then: 'it shows the line "remove partition, 12 lf, $540 to $840, quote Q-1 (2026-09-14), grade A" and the total "$1,800 to $4,100, 2 lines unpriced"'
      - id: O4-C2
        path: works
        given: a scope line priced only from a public wage
        when: the estimate is shown
        then: 'the line says "labour only, from a public wage average; materials not priced" and its grade is "C"'
      - id: O4-C3
        path: works
        given: any estimate that removes a wall
        when: it is shown
        then: 'it holds the line "beam if the wall carries load: unpriced" and ends with "Estimate only, not advice. Check it with a licensed contractor before you rely on it."'
      - id: O4-C4
        path: refused
        given: floor version 1 and no floor version 2
        when: the owner asks for the estimate
        then: 'it is refused with a sentence that contains "no redesign to price; describe one first"'
        after: the run's output holds 0 estimate lines
  - id: O5
    says: No name or other detail of a current owner or occupant reaches the owner's screen or the project's data.
    from: [asked 1]
    conditions:
      - id: O5-C1
        path: works
        given: a parcel source whose answer holds PRIMARY_OWNER "Jane Example" and MAIL_ADDR "9 Other Road"
        when: look-up stores the facts
        then: the text "Jane Example" and the text "9 Other Road" appear in 0 rows of the project's databases and 0 lines of the run's output
    noRefusal: The rule removes fields; the owner has no input that could be refused.
judged:
  - The sketch reads clearly on a phone screen.
  - Every card says plainly what leaves the machine.
leftOut:
  - Reading a plan image; it waits for the kit capability IM1.
  - Reading listing text, disclosures, inspections or other documents.
  - A value of the house after repair, a profit, financing or tax.
  - An addition outside the house outline; a second storey.
  - Telling the owner whether to buy.
open: []
decided: []
changes:
  - version: 1
    on: 2026-11-18
    added: [O1-C1, O1-C2, O1-C3, O1-C4, O1-C5, O1-C6, O2-C1, O2-C2, O2-C3, O2-C4, O2-C5, O3-C1, O3-C2, O3-C3, O3-C4, O4-C1, O4-C2, O4-C3, O4-C4, O5-C1]
    changed: []
    removed: []
```

20 conditions, 11 of them refusals. The point "42.00010, -73.90020" and all money figures are made up.

---

## 2. Public sources for one house

**Conclusion.** In New York State, three things are statewide and free through documented services: parcel facts at the parcel's centre point (year built, living area, beds, baths, lot, assessed value), building outlines, and aerial photos. Flood zones are national (FEMA). Parcel **outlines** are public in 38 of 62 counties; Dutchess and Columbia are not among them. Zoning and building permits are not published statewide or as an API anywhere I could verify; the mode links to them and drafts a records request.

### 2.1 How I read the terms

Each source was checked on 2026-11-18 from its own documentation, not by looking up any address. I fetched each terms page I could; where a page would not open, the source says so. "As-is" means the publisher disclaims warranty and states no licence. Pages fetched are listed at the end.

The mode's own rate limit is stricter than any stated one: at most one request per second to a host, and at most eight requests in one look-up.

### 2.2 New York State

| Kind | Source | Publisher | Terms as read | What it gives | How reached | Rate limits | Coverage | Status |
|---|---|---|---|---|---|---|---|---|
| Address to point | NYS Geocoder, `https://nysgeohub.ny.gov/arcgis/rest/services/Geocoder/NYS_Geocoder/GeocodeServer` | NYS ITS Geospatial Services | Item description: "available to the public"; as-is; no warranty; licence field empty | Candidates, each a point and a standard address | ArcGIS `findAddressCandidates`, JSON | None stated | Statewide | Verified (item info page) |
| Address to point, fallback and other states | Census Geocoder, `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress` | US Census Bureau | The API terms bar using the data "to identify any person, household, business"; ask for a notice; reserve a right to limit. They do not name the geocoder. | `addressMatches`: each a point and a matched address | HTTPS GET, `benchmark` required, no key | None stated; batch files up to 10,000 | United States | Verified (API doc and terms); terms' reach to the geocoder unverified |
| Parcel facts at a point | NYS Tax Parcel Centroid Points, `https://nysgeohub.ny.gov/arcgis/rest/services/Parcels/NYS_Tax_Parcel_Centroid_Points/FeatureServer/0` | NYS ITS with ORPTS and the counties | Layer: "available to the public". Parcels page: "planning and general use purposes only", "not a substitute for a legal parcel survey", as-is, counties control distribution | Year built, living area, beds, full baths, kitchens, style, heat, fuel, water, sewer, acres, frontage, depth, land and total assessed value, full market value, property class, roll year, school district | ArcGIS `query`, JSON, max 2,000 rows a request | None stated | All 62 counties; the layer says 2024 data | Verified (layer page, parcels page) |
| Parcel outline | NYS Tax Parcels Public, `https://nysgeohub.ny.gov/arcgis/rest/services/Parcels/NYS_Tax_Parcels_Public/FeatureServer/1` | NYS ITS and contributing counties | As the centroids | The lot's polygon, so lot lines and the outline's place on the lot | ArcGIS `query` with the point, JSON | 2,000 rows a request | 38 counties, among them Orange, Putnam, Rockland, Ulster, Sullivan, Greene, Westchester. Not Dutchess, Columbia or 22 others: their counties distribute the data themselves | Verified (parcels page lists the 38) |
| Assessment by point | NYS Tax Assessment Look-Up, `https://nysgeohub.ny.gov/arcgis/rest/services/GeoTools/TaxAssessmentLookup/GPServer/TaxAssessment/execute` | NYS ITS | As the parcels page | Assessment data for an X, Y point | ArcGIS geoprocessing | Not stated | Statewide | Exists (parcels page); output fields unverified. Not used in version 1 |
| Building outline | NYS Building Footprints, `https://nysgeohub.ny.gov/arcgis/rest/services/Basemap/NYS_Building_Footprints/FeatureServer/1` | NYS ITS; outlines from NYSERDA, NYC Open Data, Microsoft and the state | No copyright text on the layer | Roof outline polygon; fields CountyName, MuniName, Source, SourceDate. No address, no owner | ArcGIS `query`, JSON or GeoJSON | 2,000 rows a request | Statewide | Verified (layer page) |
| Aerial photo | NYS Orthoimagery, `https://orthos.its.ny.gov/arcgis/rest/services/wms` | NYS ITS | FAQ: "available at no cost". No licence or terms text found on the pages | An aerial image of the lot, by year | ArcGIS MapServer `export`, PNG | None stated | Statewide. Dutchess: 2025, 2021, 2016, 2013, 2009, 2004. Orange, Ulster, Putnam: from 2001. Westchester: from 2004, also 2018 and 2023 | Verified (orthoimagery page and FAQ); pixel size not stated |
| Flood zone | FEMA National Flood Hazard Layer, `https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer`, layer 28 | FEMA | No terms on the service page. Preliminary and pending data are "for review and guidance purposes only". OpenFEMA's terms page would not open | The flood zone at the point | ArcGIS `query` on layer 28 | None stated for REST; WFS 1,000 features | Where FEMA has effective maps | Service and layer verified; terms **unverified** |
| Zoning | Municipal zoning maps. Dutchess: `https://www.dutchessny.gov/Departments/Planning/zoning-maps.htm` | Each town, city or village; the county posts copies | Dutchess: PDF maps are the "official zoning maps"; the county's GIS app is "unofficial" and "for general reference only" | The zoning district | **Link only.** The owner reads the map and types the district. No API is documented. | none | Town by town. No statewide zoning layer | Verified (Dutchess page). Other counties not checked |
| Permits | Town and village building departments | Each municipality | Public under the Freedom of Information Law (research note 3.2) | Permits, certificate of occupancy, plans if filed | **Records request.** The mode drafts it; the owner sends it. Portals (East Fishkill, Wappinger, Kingston) are pages for people, not APIs | none | Not published as data anywhere I verified in the Hudson Valley | Law verified in the research note; no API found |

Turned down for property facts:

| Source | Why |
|---|---|
| Zillow, Redfin, Realtor.com, OneKey MLS | Listing sites and MLS front ends. Limit 1. Redfin's terms forbid automated crawling (research note 3.7). Zillow's and Realtor.com's own terms pages did not open; a secondary summary says Zillow bans automated queries. Ruled out whatever their terms say. |
| County parcel viewers (ParcelAccess, Image Mate, Beacon) and town portals | Pages for people with no documented API (research note 3.1). Limit 1. The mode links to them. |
| `data.ny.gov` dataset 7vem-aaz7, local assessment rolls | Covers all cities and towns except New York City, and carries owners. Its page and terms would not open, so **unverified**. Not needed: the centroid layer gives the same facts. |
| National Zoning Atlas | Its terms (sections 1.3 and 2.2) forbid storing its content without written permission and forbid scraping or automated extraction. |
| Regrid, ATTOM, RentCast and other paid property APIs | Repackage assessor data and carry owner names. Not public data. Their terms were not read. |

### 2.3 Fields dropped at the edge

The parcel layers carry the owner's name and mailing address. The source mode keeps an **allow-list** of property fields and drops every other field in the same script that parses the answer, before anything is returned, stored or logged. A field the publisher adds later is dropped too, because it is not on the list.

Kept from the centroid layer: `COUNTY_NAME`, `MUNI_NAME`, `SWIS`, `PRINT_KEY`, `SBL`, `PROP_CLASS`, `LAND_AV`, `TOTAL_AV`, `FULL_MARKET_VAL`, `YR_BLT`, `FRONT`, `DEPTH`, `ACRES`, `SQFT_LIVING`, `NBR_KITCHENS`, `NBR_FULL_BATHS`, `NBR_BEDROOMS`, `BLDG_STYLE_DESC`, `HEAT_TYPE_DESC`, `FUEL_TYPE_DESC`, `SEWER_DESC`, `WATER_DESC`, `SCHOOL_NAME`, `ROLL_YR`.

Dropped by name, and named in the test so a change to the allow-list cannot let them through: `PRIMARY_OWNER`, `ADD_OWNER`, `MAIL_ADDR`, `PO_BOX`, `MAIL_CITY`, `MAIL_STATE`, `MAIL_ZIP`, `ADD_MAIL_ADDR`, `ADD_MAIL_PO_BOX`, `ADD_MAIL_CITY`, `ADD_MAIL_STATE`, `ADD_MAIL_ZIP`, `OWNER_TYPE`, `NYS_NAME`, `NYS_NAME_SOURCE`, and `BOOK` and `PAGE` (the deed's book and page lead to a named deed).

How the rule is held:

- `property-source@1`'s output schema has `additionalProperties: false` and no field for a person. A source mode cannot return one without failing its own action's output check.
- The shared test of `property-source@1` hands each implementing mode a recorded answer with `PRIMARY_OWNER` "Jane Example" and `MAIL_ADDR` "9 Other Road", and asserts neither text appears in the action's output, the run's events or the mode's database.
- The raw answer is never written. The kernel records each request's method, URL, logged headers and status (`bay/broker/http-operations.ts`, line 78), not the answer's body. A geocoder's URL holds the address the owner approved; it stays in the run records on the machine.

### 2.4 Another state

The national sources work in every state: the Census Geocoder, FEMA's flood layer, and for outlines FEMA's USA Structures, a federal inventory of structures over 450 sq ft, published under `https://www.usa.gov/government-works` (data.gov record). Parcel facts, zoning and permits are each state's or county's.

To add a state:

1. Read the state's GIS clearinghouse for a parcel layer with a documented API. Record its URL, publisher, terms page and the date read.
2. List its fields. Write the allow-list and the dropped list as in 2.3.
3. Write a new mode, such as `ct-property`, that implements `property-source@1` and passes its shared test with a recorded answer from that state.
4. The project binds it for houses in that state (section 7).

Where a state publishes no parcel layer, the mode gives the outline and the flood zone only, and says "parcel facts: not published by this state as data".

---

## 3. Public data for costs in an area

**Conclusion.** Free public data give labour wages by trade and area, and national price indexes. They do not give the price of a kitchen, the hours a job takes, or a contractor's markup. An estimate built only on them is labour only and rough: its high end is five to eight times its low end. The owner's own contractors' quotes narrow it to the quotes' own spread.

### 3.1 What exists and is free to use

| Source | Publisher | Terms as read | What it gives | How reached | Limits |
|---|---|---|---|---|---|
| Occupational Employment and Wage Statistics (OEWS) | US Bureau of Labor Statistics | Public domain; free to use without permission; cite BLS (`https://www.bls.gov/opub/copyright-information.htm`). API terms add a notice and a right to limit. | Hourly wages by occupation and metro area: mean and percentiles. Carpenters, electricians, plumbers, painters, drywall installers, construction laborers. May 2025 figures were released on 15 May 2026. | BLS Public Data API v2 with a free key, or the flat files at `download.bls.gov/pub/time.series/oe/` | v2: 500 queries a day, 50 series a query, 50 requests in 10 seconds |
| Producer Price Index, net inputs to residential construction, goods (`WPUIP2311001`) | US Bureau of Labor Statistics | As above | A national monthly index of material prices. Latest: October 2026. | The same API | As above |
| NYS prevailing wage schedules | NYS Department of Labor | Public | Wages for public works contracts | Download | Turned down as a basis: private remodels do not pay them, so they overstate. |

What OEWS wages are not (`https://www.bls.gov/opub/hom/oews/concepts.htm`): they leave out overtime and the employer's cost of benefits, and they leave out the self-employed and owners of unincorporated firms. Many small remodelling contractors are just that. A wage is not a price.

The OEWS area matters. BLS's May 2024 release for the Kiryas Joel-Poughkeepsie-Newburgh area covers Dutchess and Orange Counties. The May 2025 estimates use revised metro area definitions; which area holds a given county now is to be read from BLS's area list when the source mode is built (unverified).

### 3.2 What a public-only line is made of

A line priced only from public data multiplies three ranges:

- **Hours.** No free public source gives the hours a job takes. The mode ships a small table of its own assumed hours per unit of work ("remove partition: 0.5 to 1.5 hours per linear foot"). Each is marked "assumed, no source". The owner can change any of them.
- **Wage.** The OEWS 25th to 75th percentile hourly wage for the trade in the area.
- **Markup.** A contractor bills more than the wage: overhead, insurance, profit, travel. No public source gives it. The mode uses a range the owner sets, 1.6 to 2.6 as a starting point, marked "your setting".

Example, with made-up wages: 12 lf of floor patch at 0.5 to 1.5 hours a foot is 6 to 18 hours. At $24 to $38 an hour and a markup of 1.6 to 2.6, the line is $230 to $1,778. The high is 7.7 times the low. Materials are not priced at all: no free source gives item prices whose terms allow a tool to use them.

That is how the range is widened to say how rough it is: by carrying every unknown as its own range and multiplying them, never by picking a middle.

### 3.3 How the owner's quotes narrow it

The price book keeps every price with its basis and picks the best grade it has for an item:

| Grade | Basis | Typical spread |
|---|---|---|
| A | The owner's contractor's quote, under a year old | The quote's own low and high, or one figure |
| B | A quote over a year old, aged by the PPI ratio; or the owner's own past job | The source's spread, high end raised by the index change |
| C | Assumed hours times a public wage times the owner's markup, labour only | About 5 to 8 times, low to high |
| unpriced | No basis | Counted, with the reason |

A quote of $45 to $70 a foot for the same 12 ft gives $540 to $840: a spread of 1.6. Each quote replaces a grade C line for the same item. The estimate shows how much of its high end rests on each grade, so the owner sees when it is mostly public averages.

The PPI is used only to age an old quote's materials. It is national and covers goods only, so it never adjusts labour and never prices a line by itself.

### 3.4 Turned down

| Source | Why |
|---|---|
| RSMeans | Its licence forbids merging the data with other software and storing it in a searchable database (clauses C.1, C.5): `https://www.trimble.com/downloads/5b7enCv3RLz3iPG00pKPQT/92cf06f5642fff215e58dcab4df775a6/RSMeans_License_Agreement.pdf` |
| Cost vs Value report | Use in any computer application needs the publisher's permission: `https://www.jlconline.com/cost-vs-value/2025/re-use-and-licensing-guidelines` (research note; not opened again) |
| Homewyse | Its terms forbid any robot or scraper and any extraction of its data: `https://www.homewyse.com/terms.html` |
| HomeAdvisor, Angi and other cost-guide sites | Terms not read. Treated as forbidding automated use until read and named here. |
| Craftsman, Xactimate and other paid price books | Licensed, not public. Not read. |
| Retailer websites, for material prices | Not checked one by one. Treated as forbidding automated use. |

---

## 4. Reading the uploaded floor plan

**Conclusion.** The kit cannot hand an image to a skill step. A task carries JSON only, the kernel's file tool reads text only, and a step agent's read grant is per mode, not per task. The smallest fix is one capability slice, IM1: a task names the files it may view, by hash, and a kernel tool returns exactly those as images. Until then the owner types the rooms in a small form, and the mode draws from that.

### 4.1 What is missing, in the code

- **The task holds no file to view.** `SkillTask` (`bay/runs/run-state.ts`, lines 6 to 18) has `input: Json` and `files: { skill, outputSchema, alsoMatches }`. `skillTaskOf` (`bay/runs/skill-steps.ts`, line 40) fills `files` with the skill and its schemas only. Nothing names a run's own file for the agent to look at.
- **The kernel's file tool reads text.** `files_read` is described as "Read one text file" (`bay/tool-definitions.ts`, line 54). Its operation calls `files.readText` (`bay/broker/file-operations.ts`, line 172). The kernel's tool server answers only `type: "text"` content (`bay/mcp-server.ts`, lines 77 and 79).
- **Reads are granted per mode, not per task.** The adapter gives a step agent `Read`, `Glob` and `Grep` only when its mode has read paths (`adapters/claude-code/agent-file.ts`, line 22). The hook checks a read against the mode's read roots, written once at build (`adapters/claude-code/steps-file.ts`, `rulesOf`; roots from `bay/policy.ts`, `grantsOfMode`). So a mode with a read grant on `homes/` would let the agent open every file there, not only the plan the owner approved on a card. Without the grant it can open none. The agent file also says to take data only from the agentbay tools and the skill's Resources files.

### 4.2 The smallest slice: IM1

A capability slice of the kernel and the Claude Code adapter.

1. `SkillTask` gains `views`: a list of `{ path, sha256, mediaType }`, at most 4, each PNG or JPEG, at most 5 MB.
2. A skill step in `mode.yaml` may name `views:` as a reference into its input, for example `views: $input.plan`. When the kernel builds the task, it checks each path is inside the mode's read paths or throwaway folders and that the file's hash equals the one given. If not, the step fails before a task exists.
3. A new kernel tool, `files_view`, with the operation `files.view`. Given the task's token and a path, it returns the image as MCP image content, only when the path is one of the task's `views` and its hash still matches.
4. The tool server answers `type: "image"` content for that tool.
5. The adapter's agent file gains one rule: when the task has `views`, look at each with `files_view`. No `Read` grant is added.

Tests: a path not in `views` is refused; a file changed after the card is refused; a text file named as a view is refused; `files_read` still refuses a binary file.

Metadata is removed before the card, not by the kernel. The home mode lists one command, `strip-metadata` (exiftool, writing a clean copy into the mode's throwaway folder `homes-views/`), which the owner trusts once. The view names the clean copy.

The plan card then shows: the file, its pixel size, the start of its hash, "metadata removed", the tier and the model it maps to. The owner opens the file himself to see the image.

### 4.3 The fallback for the first version

The owner types the rooms. `floor-in` writes a blank form, `homes/<house>/rooms.yaml`, when none exists. He reads sizes off the plan he has, or measures, and fills it in: the outline, then each room as corners in feet and inches from the outline's south-west corner, then doors, windows and fixtures he cares about. Section 5 shows the form filled in.

Most rooms are rectangles: two corners are enough, `from` and `to`. An L-shaped room lists its corners in order. Feet and inches are written as `13-0` (13 ft 0 in) or as inches.

When the public outline is known (section 2), the form starts with it, so the owner types only the rooms.

---

## 5. The room model and the 2D sketch

**Conclusion.** One floor is a small YAML model: an outline, rooms as corner lists in whole inches, openings on the walls between rooms, and fixtures. Walls are derived from the rooms' edges, never typed. The owner's words become a list of changes by a model's step; a script applies them and refuses any result where a room does not close, leaves the outline or breaks the area sum. A script draws before and after side by side, to scale, as one SVG.

### 5.1 The model

| Part | What it holds | Units and rules |
|---|---|---|
| `outline` | The house's outer edge on this floor, corners in order | Whole inches. From the public outline or typed. |
| `rooms` | Each: `id` (kebab-case), `name`, `corners` in order | Whole inches. Edges run north-south or east-west in version 1. |
| `openings` | Each: `id`, `kind` (door, window, cased), the two rooms it joins (or one room and `outside`), its centre along the shared edge, `width` | Whole inches |
| `fixtures` | Each: `id`, `kind` (sink, range, refrigerator, toilet, tub, shower, base-cabinet run), `room`, `at`, `size`, `needs` (water, drain, gas, vent) | Whole inches |
| `sizes` | Where the sizes came from: `typed`, `measured`, `public-outline`, later `read-from-plan` | Sets the quantity range in section 6 |

Derived by script, never stored: each wall (an edge shared by two rooms is an interior wall; an edge on the outline is exterior), its length, each room's area, and the area not in any room (halls, stairs, wall thickness).

Every wall's `load` is `unknown`. The mode never sets it. A later version may let the owner set `carries-load` or `no-load` with the name of the professional who said so.

Whole inches avoid rounding: areas are exact in square inches and shown in square feet to one decimal. A metric setting can come later.

### 5.2 Example: floor version 1 of house example-1

```yaml
house: example-1
level: 1
version: 1
unit: in
sizes: typed
outline: [[0, 0], [432, 0], [432, 336], [0, 336]]
rooms:
  - id: kitchen
    name: Kitchen
    corners: [[0, 0], [156, 0], [156, 144], [0, 144]]
  - id: dining
    name: Dining
    corners: [[156, 0], [300, 0], [300, 144], [156, 144]]
  - id: living
    name: Living
    corners: [[0, 144], [300, 144], [300, 336], [0, 336]]
  - id: bath
    name: Bath
    corners: [[300, 0], [432, 0], [432, 96], [300, 96]]
  - id: bedroom
    name: Bedroom
    corners: [[300, 96], [432, 96], [432, 336], [300, 336]]
openings:
  - id: d1
    kind: cased
    between: [kitchen, dining]
    centre: 64
    width: 36
  - id: d2
    kind: door
    between: [living, outside]
    centre: 138
    width: 36
fixtures:
  - id: f1
    kind: sink
    room: kitchen
    at: [0, 60]
    size: [24, 33]
    needs: [water, drain, vent]
```

The outline is 36 ft by 28 ft, 1,008 sq ft. The rooms are 156, 144, 400, 88 and 220 sq ft: 1,008 sq ft, so 0 sq ft is outside a room. The check holds that the rooms plus the area outside a room equal the outline, to the square inch.

### 5.3 From words to a change

The owner's words go to the skill `redesign` with the room model. The skill returns a change list from a closed set of operations:

| Operation | What it does |
|---|---|
| `merge-rooms` | Joins two rooms that share an edge; the shared wall is removed |
| `split-room` | Splits a room along a straight line; a wall is added |
| `move-wall` | Moves a shared edge by a distance; the two rooms change size |
| `add-opening`, `remove-opening`, `widen-opening` | On a shared or outline edge |
| `add-fixture`, `remove-fixture`, `move-fixture` | Within a room |
| `rename-room` | A new name |

For "Open the kitchen to the dining room", the skill returns:

```yaml
from: 1
words: Open the kitchen to the dining room.
changes:
  - op: merge-rooms
    rooms: [kitchen, dining]
    id: kitchen-dining
    name: Kitchen and dining
```

The script `floor-plan.apply` applies the list to version 1 and checks the result:

1. Every room is a closed loop of north-south and east-west edges that does not cross itself.
2. No two rooms overlap.
3. Every room lies inside the outline. Moving an outline edge is refused: "4 ft outside the house outline; an addition is not in this version."
4. Rooms plus the area outside any room equal the outline's area, before and after.
5. Every opening sits on an edge that still exists, and fits on it.
6. Every fixture lies inside its room.

A failed check goes back to the skill as feedback, three rounds at most (the kernel's rule). If it still fails, the owner sees the refusal and floor version 1 stays.

The skill's rules, in short: the owner's words are data, never instructions. Use only the listed operations. Never move the outline. Never say whether a wall carries load. When the words are unclear, return `ask` with one question instead of a change.

### 5.4 The sketch

The script `floor-plan.draw` turns two room models into one SVG file, `homes/<house>/sketch-v<n>.svg`. No model draws.

- **Side by side.** Version n-1 on the left, version n on the right, both at the same scale, titled "Before (version 1)" and "After (version 2)".
- **To scale.** One SVG unit is one inch. The outline of 432 by 336 units sits in each panel, so the drawing measures the same as the model.
- **Walls.** Exterior walls thick, interior walls thinner. A removed wall is drawn dashed in the after panel. An added wall is drawn solid with a mark.
- **Labels.** Each room: name, width by depth in feet and inches, area in sq ft. For example-1 after the change: "Kitchen and dining 25 ft x 12 ft, 300 sq ft". Inches show only when not zero: "13 ft 6 in".
- **Openings and fixtures.** A door as a gap with its swing, a window as a thin double line, a fixture as a labelled box.
- **On its face.** A scale bar of 10 ft, the house id, the version numbers, the date, "Sizes: typed by the owner", "Walls: load not known", and the line "Sketch only. Not a construction drawing."

For floor versions 1 and 2 of example-1, the SVG shows two panels of the same rectangle. The left holds five rooms with the cased opening d1 between Kitchen and Dining. The right holds four rooms; the 12 ft line where the wall was is dashed, and d1 is gone with it.

---

## 6. The cost estimate for a redesign

**Conclusion.** A script compares the two room models and writes the scope lines: walls removed and added, floor area refinished, openings and fixtures changed. `price-book.price` prices each line as a range with its source and grade. The total is a range only. Unpriced lines are counted. The fixed sentences close it.

### 6.1 Scope lines from the difference

The script `floor-plan.diff` compares version n-1 with version n. No model is involved (P-32).

| Difference | Scope line | Quantity |
|---|---|---|
| A wall removed | `remove-partition`, and `beam-if-load`, always unpriced | Wall length |
| A wall added | `add-partition` | Wall length |
| A wall moved | `remove-partition` and `add-partition` | Both lengths |
| A removed or moved wall | `floor-patch` along it | Wall length |
| Rooms merged with different floors | `refinish-floor` over the merged room | Its area |
| An opening added, widened or removed | `add-opening`, `widen-opening`, `close-opening` | Count, width |
| A fixture moved or added that needs water, drain or gas | `move-plumbing-fixture` | Count, and the distance moved |
| A removed or moved wall | `electrical-in-wall`, unpriced: the model holds no wiring | 1 |

Quantity range: a size from the owner's tape or the public outline gives low equal to high. A size typed from a plan gives plus or minus 5 percent. Later, a size read from a plan image gives plus or minus 10 percent.

### 6.2 Example: the estimate for example-1, version 1 to version 2

The prices below are made up for the example, including the wages.

```
Estimate: example-1, version 1 to version 2
Open the kitchen to the dining room.

remove partition, 12 lf
  $540 to $840
  quote Q-1 (2026-09-14), grade A
beam if the wall carries load
  unpriced: load not known
floor patch, 12 lf
  $230 to $1,778
  labour only, from a public wage average;
  materials not priced. Grade C.
  6 to 18 h assumed; wage $24 to $38
  (BLS OEWS, May 2025); markup 1.6 to 2.6
  (your setting)
refinish floor, 300 sq ft
  $1,050 to $1,500
  your job "Elm St floor", 2025, grade B
electrical in the wall
  unpriced: the plan holds no wiring

Total: $1,800 to $4,100
Leaves out 2 unpriced lines.
High end by grade: A 20%, B 36%, C 43%.
Asking price $389,000 (given by you).

A wall may carry load. Have a licensed
engineer or architect look first.
Estimate only, not advice. Check it with a
licensed contractor before you rely on it.
```

How the figures are made:

- A line's low is the low quantity times the low price; its high is the high quantity times the high price.
- The total is the sum of lows and the sum of highs, each rounded to the nearest $100. It is never one figure and never a "most likely" figure.
- A contingency, if the owner sets one, is its own line, marked as his.
- The asking price is shown as given, beside the estimate. The mode adds nothing to it and says nothing of value or profit.
- The estimate is computed each time from the two floor versions and the current price book. It is never stored (P-51).

---

## 7. Modules, interfaces, data and approvals

**Conclusion.** The `home` mode owns houses, floors and the cards. Five interfaces keep the parts that change apart: `property-source@1` (one mode per state), `flood-source@1`, `floor-plan@1` (geometry and drawing, pure scripts), `price-book@1` and `wage-source@1`. Two skills; everything else is a script. The owner approves every send, every model read, and every change before it is kept.

### 7.1 Modules and what each hides

| Module | Kind | Hides | Network hosts |
|---|---|---|---|
| `home` | new mode | The flow, the cards, which source gets what, the typed form, how facts are kept per house | none |
| `ny-property` | new mode, implements `property-source@1` | The NYS geocoder, parcel and outline layers, their URLs and fields, the allow-list of 2.3, falling back to the Census Geocoder | `nysgeohub.ny.gov`, `geocoding.geo.census.gov` |
| `fema-flood` | new mode, implements `flood-source@1` | The NFHL layer, its fields, how a zone is read at a point | `hazards.fema.gov` |
| `floor-plan` | new mode, implements `floor-plan@1` | The room model's geometry: checks, applying changes, the difference, the SVG | none |
| `price-book` | new mode, implements `price-book@1` | Where each price comes from, its grade and age, the assumed hours, the markup, how ranges multiply | none |
| `bls-wages` | new mode, implements `wage-source@1` | The BLS API, its series ids, the area codes, the key | `api.bls.gov` |
| `store` | existing base mode | Unchanged; not used in version 1 | none |

Why so many: each network host sits in one small mode, so the owner can see on the manifest which mode can reach which host, and a terms change touches one mode. A new state is one new mode. The geometry has no host and no table, so it is easy to test by itself.

### 7.2 The interfaces

```yaml
name: property-source
version: 1
actions:
  describe:
    input: property-source/describe-request.json
    output: property-source/describe-response.json
    effects: [read]
  find:
    input: property-source/find-request.json
    output: property-source/find-response.json
    effects: [read, network]
  facts:
    input: property-source/facts-request.json
    output: property-source/facts-response.json
    effects: [read, network]
```

- `describe`: for each source the mode uses, its name, host, publisher, terms URL, the date the terms were read, and what `find` and `facts` send to it. The home mode builds its cards from this, so a card always matches what the mode sends.
- `find`: an address as typed, and the sources the owner approved. Returns 0 or more candidates, each a point and a standard address, or `unavailable` with the source and status.
- `facts`: a point, and the sources approved. Returns property facts from a closed list, each with its source, roll year or date; the outline polygon; the parcel polygon where published. No field for a person. A source that fails comes back as `unavailable`, and the rest are kept.

`flood-source@1` has `describe` and `zone` (a point to a zone, or `unavailable`).

`floor-plan@1`, all effects `read`, all scripts: `check` (a model to problems), `apply` (a model and a change list to a new model or problems), `diff` (two models to scope quantities), `draw` (two models to SVG text).

`price-book@1` keeps version 1's actions (`items`, `price`, `add`) and adds `assume` (set an item's assumed hours) and `wages` (store a wage table from `wage-source@1`).

`wage-source@1`: `describe` and `wages` (an area code and occupation codes to percentile wages and the reference period).

### 7.3 The home mode's actions

| Action | Kind | Effects | Steps |
|---|---|---|---|
| `house-add` | action | read, write | script |
| `look-up` | workflow | read, write | script `describe-sends`; approval `send-address`; call `property-source.find`; approval `pick-match` when 2 or more; approval `send-point`; call `property-source.facts`; call `flood-source.zone`; script `keep-facts` |
| `price-set` | action | read, write | script |
| `floor-in` | action | read, write | script `read-form`; call `floor-plan.check`; script `keep-floor`; call `floor-plan.draw` |
| `redesign` | workflow | read, write | script `words-card`; approval `send-words`; skill `redesign` (checked by `floor-plan.apply`); call `floor-plan.draw`; approval `accept-change`; script `keep-floor` |
| `price-add` | workflow | read, write | script `prices-card` from what the owner typed; approval `add-prices`; call `price-book.add` |
| `wages-fetch` | workflow | read, write | script `wage-card`; approval `send-wage-request`; call `wage-source.wages`; call `price-book.wages` |
| `estimate` | action | read | call `floor-plan.diff`; call `price-book.price`; script `lay-out` |
| `facts` | action | read | script |
| `records-request` | action | read | script: drafts a records request to the building department, for the owner to send |

The home mode itself has no network host. It reaches sources only through the interfaces, and only with the sources and values the owner approved; the source modes refuse a request that names a source not in the approval.

### 7.4 Data model and who owns each table

Each table has one owner (P-38, P-42). Another mode asks the owner through its actions. Every table is made by a numbered migration (P-43, P-51).

| Table | Owner | Holds |
|---|---|---|
| houses | `home` | id (kebab-case), label, address as typed, state, asking price in whole dollars, created at |
| sends | `home` | Each card answered: house, card kind, the sources, exactly what was sent to each, the hash of the card, the owner's choice and words, when |
| facts | `home` | house, field (closed list), value, unit, source, roll year or date, fetched at. One row per house, field and source (P-46). |
| outlines | `home` | house, kind (building or parcel), polygon in inches from a local origin, source, date |
| floors | `home` | house, level, version, the model as JSON, made by (typed or change), parent version, the change list, the owner's words, the approval that accepted it |
| items_known | `price-book` | item code, unit, says, assumed hours low and high |
| prices | `price-book` | item code, low, high, unit, date, kind (quote, own-job, public), basis, area |
| wages | `price-book` | area code, occupation code, 25th and 75th percentile hourly wage, reference period, fetched at |
| public_sources | `price-book` | name, URL, terms URL, date read, the use the terms allow in one sentence |

`floor-plan`, `ny-property`, `fema-flood` and `bls-wages` own no table. The address is kept only in `houses` and `sends`, on the machine.

Settings of the home mode, kept in the project and never sent: `private.addresses` (the owner's own addresses; a typed address equal to one is refused before any card), `markup` (low and high), `contingency`.

Practices this layout keeps: names say what each mode does (P-36); each interface has three or four actions that do something whole (P-37); dependencies point one way, from `home` to the interfaces, and no source mode calls `home` (P-39); a terms change touches one source mode (P-40); each mode's tests sit in its folder (P-41); `keep-facts` writes all of a look-up's facts in one transaction (P-45); queries take parameters, name columns, carry a limit and run once per action, not per row (P-44, P-48, P-49); tests use the real database (P-50); `estimate` and `facts` write nothing (P-51).

### 7.5 Scripts, skills and tiers

| Step | Script or skill | Tier | Why |
|---|---|---|---|
| Building cards, matching, keeping facts | script | none | No judgement |
| Calls to sources | script in the source mode | none | A request and a parse |
| Dropping person fields | script in the source mode | none | An allow-list |
| Reading the typed form | script | none | Parsing |
| Checking, applying, diffing, drawing a floor | script in `floor-plan` | none | Geometry |
| Pricing, laying out | script | none | Arithmetic |
| `redesign` | skill | deep | Turning spatial words into operations on a plan is the hardest judgement here |
| `read-plan`, after IM1 | skill | deep | Tracing walls and rooms from an image |

### 7.6 Every approval the owner gives

| Approval | When | What the card shows | Choices |
|---|---|---|---|
| `send-address` | Each look-up | Each geocoder by name and host, the exact text sent ("12 Example Lane, Sampletown NY"), the terms' date, "Nothing else is sent" | `send`, `keep-local` |
| `pick-match` | 2 or more matches | Each match's standard address | `match-1`, `match-2`, and so on, and `none` |
| `send-point` | After a match | The point to 5 decimals, and each source that gets it, by name and host | `send`, `keep-local` |
| `send-words` | Each redesign | His words, the room model's size in rooms and lines, "No address is sent", the tier and its model | `send`, `keep-local` |
| `accept-change` | Each redesign | The change list, the checks passed, the rooms before and after with areas, the path of the new sketch | `accept`, `send-back` with his note, `discard` |
| `send-wage-request` | When wages are fetched | The area code and the occupation codes sent to `api.bls.gov` | `send`, `keep-local` |
| `add-prices` | Each quote or past job entered | Each price: item, low, high, unit, date, basis | `add`, `discard` |
| `send-plan`, after IM1 | Each plan image | File, pixel size, hash start, "metadata removed", tier and model | `send`, `keep-local` |
| Trust | Once for a mode that lists commands (`home` after IM1, for `strip-metadata`) | The kernel's trust card | trust, or not |

The `send-address` card, as the owner would read it (at most 44 columns):

```
Send this address to look it up?
house example-1

To: NYS Geocoder (NYS ITS)
    nysgeohub.ny.gov
Sent: "12 Example Lane, Sampletown NY"

Nothing else is sent: no name, no notes,
no other address.
Terms read 2026-11-18: public service,
as-is.

send / keep-local
```

The room model never holds the address, so the `redesign` skill never sees it.

---

## 8. The smallest useful version and its slices

**Conclusion.** Start from a typed room model, the sketch and the estimate, not from the address. That is the part the owner asked for that no county portal gives him. It needs no network, no kernel change and no new terms to verify. The address look-up comes second, as its own small slices, and fills the outline the owner would otherwise type.

### 8.1 Why not start from the address

- The look-up gives facts the owner can already read on a county viewer by hand. The sketch and the estimate give him something he has no tool for.
- Steps 3 to 5 need the typed form anyway, until IM1. So the room model is on the path whatever comes first.
- The redesign skill is the riskiest part: whether a model turns words into a valid change. It should be tested on a real house first.
- The look-up is plumbing: two source modes, two cards, an allow-list. It is well understood and adds no risk to the rest.

### 8.2 Version 1

- `house-add`, `price-set`, `floor-in` from the typed form, `redesign` with its two cards, `estimate`.
- The price book with quotes and own jobs the owner types (`price-add`), assumed hours, the markup setting, and BLS wages fetched after a card (`wages-fetch`).
- Useful the day it ships: the owner types a house from its listing plan, says what he wants changed, and sees the sketch and a cost range.

### 8.3 Plan fragment

In the form of `docs/plans/0024-forge-whole.yaml`. Not run through `forge.waves`.

```yaml
title: 'The home mode, version 1: a typed floor plan, a redesign from the owner''s words, a sketch before and after, and a cost range from his prices and public wages'
slices:
- title: The interface floor-plan@1 and its shared test fix the room model, the change operations and the four actions check, apply, diff and draw
  slice:
    name: FP1
    kind: interface
    scope:
    - components/base/interfaces/floor-plan.yaml
    - components/base/interfaces/floor-plan/**
    after: []
    done:
    - id: DOD-FP1-1
      says: The shared test holds floor version 1 and the change of section 5 of the design note, and asserts the after model's rooms, areas and the diff's 12 lf of removed wall.
      level: must
      proof:
        kind: fails-first
        tests:
        - components/base/interfaces/floor-plan/shared.ts
    - id: DOD-FP1-2
      says: The kit's checks and its whole test run pass.
      level: must
      proof:
        kind: checks
- title: The interface price-book@1 and its shared test, with grades, ranges, assumed hours and stored wages
  slice:
    name: PB1
    kind: interface
    scope:
    - components/base/interfaces/price-book.yaml
    - components/base/interfaces/price-book/**
    after: []
    done:
    - id: DOD-PB1-1
      says: The shared test prices 12 lf at $45 to $70 as $540 to $840 grade A, refuses a price with no date or basis, and returns an unknown item as unpriced with its reason.
      level: must
      proof:
        kind: fails-first
        tests:
        - components/base/interfaces/price-book/shared.ts
    - id: DOD-PB1-2
      says: The kit's checks and its whole test run pass.
      level: must
      proof:
        kind: checks
- title: The interface wage-source@1 and its shared test, from an area and occupations to percentile wages and their period
  slice:
    name: WS1
    kind: interface
    scope:
    - components/base/interfaces/wage-source.yaml
    - components/base/interfaces/wage-source/**
    after: []
    done:
    - id: DOD-WS1-1
      says: The shared test asks for 2 occupations in 1 area and gets each with a 25th and 75th percentile wage and a reference period, and gets unavailable with the status when the source fails.
      level: must
      proof:
        kind: fails-first
        tests:
        - components/base/interfaces/wage-source/shared.ts
    - id: DOD-WS1-2
      says: The kit's checks and its whole test run pass.
      level: must
      proof:
        kind: checks
- title: The floor-plan mode checks a room model, applies changes, finds the difference and draws before and after as one SVG to scale
  slice:
    name: FP2
    kind: mode
    against: floor-plan@1
    scope:
    - components/modes/floor-plan/**
    after:
    - slice: FP1
      because: It implements floor-plan@1.
    done:
    - id: DOD-FP2-1
      says: The shared test of floor-plan@1 passes.
      level: must
      proof:
        kind: fails-first
        tests:
        - components/modes/floor-plan/tests/shared.test.ts
    - id: DOD-FP2-2
      says: Moving the kitchen's west wall out 4 ft is refused with "4 ft outside the house outline", and overlapping rooms are refused with the overlap in inches.
      level: must
      proof:
        kind: fails-first
        tests:
        - components/modes/floor-plan/tests/refusals.test.ts
    - id: DOD-FP2-3
      says: The SVG of versions 1 and 2 has a 432 by 336 unit outline in each panel, a 120 unit scale bar labelled 10 ft, and the text "Sketch only. Not a construction drawing."
      level: must
      proof:
        kind: fails-first
        tests:
        - components/modes/floor-plan/tests/draw.test.ts
    - id: DOD-FP2-4
      says: The mode's manifest grants no network host and lists no command.
      level: must
      proof:
        kind: count
        pattern: 'network:|commands:'
        paths:
        - components/modes/floor-plan/mode.yaml
        most: 0
    - id: DOD-FP2-5
      says: The sketch reads clearly on a phone screen.
      level: should
    - id: DOD-FP2-6
      says: The kit's checks and its whole test run pass.
      level: must
      proof:
        kind: checks
- title: The price-book mode keeps quotes, own jobs, assumed hours and wages, and prices scope lines as graded ranges
  slice:
    name: PB2
    kind: mode
    against: price-book@1
    scope:
    - components/modes/price-book/**
    after:
    - slice: PB1
      because: It implements price-book@1.
    done:
    - id: DOD-PB2-1
      says: The shared test of price-book@1 passes.
      level: must
      proof:
        kind: fails-first
        tests:
        - components/modes/price-book/tests/shared.test.ts
    - id: DOD-PB2-2
      says: 12 lf at 0.5 to 1.5 assumed hours, wages $24 to $38 and markup 1.6 to 2.6 gives $230 to $1,778, grade C, with the words "labour only, from a public wage average; materials not priced".
      level: must
      proof:
        kind: fails-first
        tests:
        - components/modes/price-book/tests/public-line.test.ts
    - id: DOD-PB2-3
      says: The kit's checks and its whole test run pass.
      level: must
      proof:
        kind: checks
- title: The bls-wages mode fetches area wages by occupation from the BLS API with a key, and keeps nothing itself
  slice:
    name: BW1
    kind: mode
    against: wage-source@1
    scope:
    - components/modes/bls-wages/**
    after:
    - slice: WS1
      because: It implements wage-source@1.
    done:
    - id: DOD-BW1-1
      says: The shared test of wage-source@1 passes on recorded BLS answers.
      level: must
      proof:
        kind: fails-first
        tests:
        - components/modes/bls-wages/tests/shared.test.ts
    - id: DOD-BW1-2
      says: The manifest names api.bls.gov as its only host.
      level: must
      proof:
        kind: count
        pattern: 'api\.bls\.gov'
        paths:
        - components/modes/bls-wages/mode.yaml
        most: 1
    - id: DOD-BW1-3
      says: One real call for 2 occupations in 1 area returns wages and the reference period May 2025.
      level: must
      proof:
        kind: real-thing
    - id: DOD-BW1-4
      says: The kit's checks and its whole test run pass.
      level: must
      proof:
        kind: checks
- title: 'The home mode holds houses, the asking price and a typed floor, and draws it'
  slice:
    name: HM1
    kind: mode
    scope:
    - components/modes/home/**
    after:
    - slice: FP2
      because: floor-in checks and draws through floor-plan@1.
    done:
    - id: DOD-HM1-1
      says: The literal conditions O2-C1 to O2-C5 of the design note hold.
      level: must
      proof:
        kind: fails-first
        tests:
        - components/modes/home/tests/floor-in.test.ts
        - components/modes/home/tests/price.test.ts
    - id: DOD-HM1-2
      says: The mode's manifest grants no network host.
      level: must
      proof:
        kind: count
        pattern: 'network:'
        paths:
        - components/modes/home/mode.yaml
        most: 0
    - id: DOD-HM1-3
      says: The kit's checks and its whole test run pass.
      level: must
      proof:
        kind: checks
- title: The redesign workflow turns the owner's words into a checked change after a card, and keeps it only when he accepts
  slice:
    name: HM2
    kind: mode
    scope:
    - components/modes/home/**
    after:
    - slice: HM1
      because: It changes floors that HM1 stores.
    done:
    - id: DOD-HM2-1
      says: The literal conditions O3-C1 to O3-C4 of the design note hold, with the skill answered by the test toolbox.
      level: must
      proof:
        kind: fails-first
        tests:
        - components/modes/home/tests/redesign.test.ts
    - id: DOD-HM2-2
      says: The skill's task holds the owner's words and the room model and no address.
      level: must
      proof:
        kind: fails-first
        tests:
        - components/modes/home/tests/redesign-task.test.ts
    - id: DOD-HM2-3
      says: On one real house the owner typed, a redesign in his words gives a change he accepts.
      level: must
      proof:
        kind: real-thing
    - id: DOD-HM2-4
      says: The kit's checks and its whole test run pass.
      level: must
      proof:
        kind: checks
- title: The owner adds prices and fetches wages after a card, and the estimate prices the difference between two floors as graded ranges, counts unpriced lines and ends with the fixed sentences
  slice:
    name: HM3
    kind: mode
    scope:
    - components/modes/home/**
    after:
    - slice: HM2
      because: It prices the change that HM2 keeps.
    - slice: PB2
      because: It prices through price-book@1.
    - slice: BW1
      because: Grade C lines need stored wages, fetched after the wage card.
    done:
    - id: DOD-HM3-1
      says: The literal conditions O4-C1 to O4-C4 of the design note hold.
      level: must
      proof:
        kind: fails-first
        tests:
        - components/modes/home/tests/estimate.test.ts
    - id: DOD-HM3-4
      says: Answering keep-local on the wage card sends 0 requests, and answering send stores the wages with their reference period.
      level: must
      proof:
        kind: fails-first
        tests:
        - components/modes/home/tests/wages-fetch.test.ts
    - id: DOD-HM3-2
      says: The estimate action writes nothing.
      level: must
      proof:
        kind: fails-first
        tests:
        - components/modes/home/tests/estimate-reads.test.ts
    - id: DOD-HM3-3
      says: The kit's checks and its whole test run pass.
      level: must
      proof:
        kind: checks
```

Waves: FP1, PB1 and WS1 side by side; then FP2, PB2 and BW1; then HM1, HM2, HM3, one after another since they share the home mode's folder. The longest chain is FP1, FP2, HM1, HM2, HM3: five waves.

### 8.4 After version 1, in order

| Slice | Kind | What it adds |
|---|---|---|
| PS1 | interface | `property-source@1` and its shared test, with the person-field test of 2.3 (DOD-PS1-2) |
| FS1 | interface | `flood-source@1` and its shared test |
| NY1 | mode | `ny-property`: NYS Geocoder, centroids, parcel outline, building outline, Census fallback, the allow-list (DOD-NY1-2: the recorded answer with "Jane Example" leaves no trace) |
| FE1 | mode | `fema-flood`, once OpenFEMA's or FEMA's terms are read |
| HM4 | mode | `look-up` with `send-address`, `pick-match` and `send-point`; `facts`; the outline fills the typed form (O1, O5) |
| HM5 | mode | `records-request`: a draft for the building department |
| IM1 | capability | `views` in a task, `files_view`, image content (section 4.2) |
| HM6 | mode | `send-plan` and the `read-plan` skill; the typed form stays as the fallback |

---

## 9. Questions only the owner can answer

**Answered on 20 November.** The owner's words: "1. All. 2 all. 3. I can't 4. Agree 5. Agree. 6. Agree".

1. Counties: all seven named here: Orange, Putnam, Ulster, Westchester, Rockland, Dutchess and Columbia. In Dutchess and Columbia the state publishes no parcel outline, so the owner types more of it.
2. Both are built: the typed plan with sketch and estimate, and the address look-up. The reviewer reads "all" as both parts, in the order this note recommends (the typed plan first, the look-up after); to be confirmed with the owner.
3. No contractor quotes or past job costs can be given. Every cost line starts from public data only: labour from a public wage average, with the wide spread section 3 describes. The price book stays in the design so quotes can be added later.
4. Lines that rest on public data only are shown as wide ranges, labelled, with their share of the total.
5. Only the session's own provider reads the owner's words and later the plan images, at the deep tier for the redesign; the address never goes to a model.
6. Feet and inches, typed as `13-0`, stored as whole inches.

**Conclusion.** Six questions. The first decides which sources are worth building first, since coverage differs by county.

1. **Which county or counties are you looking in?** Coverage differs. Orange, Putnam, Ulster, Westchester and Rockland publish parcel outlines through the state; Dutchess and Columbia do not, so there the mode gives the parcel's centre-point facts and the building outline, not the lot lines. Recommendation: name the one or two counties you will really look in first; the first source mode is built and tested for them.
2. **Start with the typed plan, sketch and estimate, or with the address look-up?** Recommendation: the typed plan first (section 8.1). The look-up follows as slices PS1 to HM4.
3. **Can you give two or three contractor quotes, or costs from past jobs, to start the price book?** Without them every line is grade C, labour only, with a spread of about 5 to 8 times. Recommendation: yes, even old ones; they become grade B and narrow the range at once.
4. **Show public-only lines as wide ranges, or as unpriced?** Recommendation: show them, labelled "labour only, from a public wage average", with the share of the total they make up. Hiding them would hide the work.
5. **Which model may read your words, and later your plan images?** Every card names it. Recommendation: the harness's own provider only, deep tier for the redesign. Your words and the room model go; the address never does.
6. **Feet and inches for typing and labels?** Recommendation: yes, typed as `13-0`, stored as whole inches. A metric setting can come later if a plan arrives in metres.

---

## Sources

Read in the kit for this note: `bay/runs/run-state.ts`, `bay/runs/skill-steps.ts`, `bay/runs/runs.ts`, `bay/tool-definitions.ts`, `bay/broker/file-operations.ts`, `bay/broker/http-operations.ts`, `bay/mcp-server.ts`, `bay/policy.ts`, `bay/adapter.ts`, `adapters/claude-code/agent-file.ts`, `adapters/claude-code/steps-file.ts`, `schemas/mode.schema.json`, and the documents named at the top.

Opened on 2026-11-18, from documentation only, and treated as data. No address, parcel or person was looked up.

- NYS parcels page (coverage, services, disclaimer): https://gis.ny.gov/parcels
- NYS parcel centroid layer (fields): https://nysgeohub.ny.gov/arcgis/rest/services/Parcels/NYS_Tax_Parcel_Centroid_Points/FeatureServer/0
- NYS public parcels service: https://nysgeohub.ny.gov/arcgis/rest/services/Parcels/NYS_Tax_Parcels_Public/FeatureServer
- NYS Building Footprints layer: https://nysgeohub.ny.gov/arcgis/rest/services/Basemap/NYS_Building_Footprints/FeatureServer/1
- NYS Geocoder item information: https://nysgeohub.ny.gov/arcgis/rest/services/Geocoder/NYS_Geocoder/GeocodeServer/info/iteminfo?f=pjson
- NYS legacy locators, retired October 2026: https://gis.ny.gov/address-geocoder
- NYS orthoimagery and its FAQ: https://gis.ny.gov/orthoimagery and https://gis.ny.gov/orthoimagery-faqs
- NYS GIS disclaimer (external links only): https://gis.ny.gov/disclaimer
- Census Geocoder API: https://geocoding.geo.census.gov/geocoder/Geocoding_Services_API.html
- Census geocoding services page: https://www.census.gov/data/developers/data-sets/Geocoding-services.html
- Census Geocoder documentation: https://www.census.gov/programs-surveys/geography/technical-documentation/complete-technical-documentation/census-geocoder.html
- Census API terms of service: https://census.gov/data/developers/terms-of-service.html
- FEMA flood map services: https://hazards.fema.gov/femaportal/resources/flood_map_svc.htm
- USA Structures on data.gov: https://catalog.data.gov/dataset/usa-structures
- Local assessment rolls on data.gov: https://catalog.data.gov/dataset/property-assessment-data-from-local-assessment-rolls
- Dutchess zoning maps: https://www.dutchessny.gov/Departments/Planning/zoning-maps.htm
- Dutchess GIS data: https://www.dutchessny.gov/County-Government/GIS-Data.htm
- National Zoning Atlas terms: https://zoningatlas.org/terms
- BLS copyright: https://www.bls.gov/opub/copyright-information.htm
- BLS API FAQ and terms: https://www.bls.gov/developers/api_faqs.htm and https://www.bls.gov/developers/termsOfService.htm
- OEWS concepts: https://www.bls.gov/opub/hom/oews/concepts.htm
- OEWS series layout: https://download.bls.gov/pub/time.series/oe/oe.txt
- OEWS May 2025 release, 15 May 2026: https://www.bls.gov/news.release/archives/ocwage_05152026.htm
- OEWS Kiryas Joel-Poughkeepsie-Newburgh, May 2024: https://www.bls.gov/regions/northeast/news-release/occupationalemploymentandwages_kiryasjoel.htm
- PPI net inputs to residential construction, goods: https://fred.stlouisfed.org/series/WPUIP2311001
- Homewyse terms: https://www.homewyse.com/terms.html

Tried and not opened:

| Target | Result |
|---|---|
| OpenFEMA terms, https://fema.gov/about/openfema/terms-conditions | The site returned an error. FEMA's flood terms are unverified. |
| `data.ny.gov` dataset page | Not reachable from this session |
| Zillow and Realtor.com terms pages | Not reached; a secondary summary only. Ruled out by limit 1 regardless. |
| HomeAdvisor and Angi terms | Not tried; treated as forbidding |

From version 1 and the research note of 2026-11-16, not opened again: the RSMeans licence, the Cost vs Value reuse guidelines, NYS prevailing wage schedules, Redfin's terms, the Committee on Open Government opinions on building plans.
