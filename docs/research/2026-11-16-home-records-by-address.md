# Public records for one house: layout, measurements and photos (New York, Hudson Valley first)

Research date: 2026-11-16. Builds on `/home/claude/research/hudson-valley-real-estate-data.md` (2026-11-14) and does not repeat it.

This is not legal advice. The law is stated as the sources describe it.

## How to read the labels

- **verified**: I read it today on the agency's or vendor's own page. The URL is given.
- **secondary**: I read it on someone else's page (a directory, a wiki, a review site).
- **unverified**: from general knowledge, or I could not open the page. Check before building on it.

**Limits of this session.** Direct HTTP is blocked. The fetch tool opens only URLs that a web search returned. So I could not read any `robots.txt`, could not open most county applications, and could not open Zillow's or Realtor.com's terms pages. I did not log in, submit a form, or look up any private address. No ArcGIS query was run; I read layer metadata pages only.

---

## 1. The answer

1. **There is no public register of interior floor plans for ordinary houses in New York.** No agency publishes room-by-room layouts with dimensions by address.
2. **Four kinds of public record carry part of a layout:**
   - The **assessor's property record card**: exterior building sketch with dimensions (usually), area by storey, room, bedroom and bath counts. No interior walls.
   - The **building department file**: plans filed with permits, if any were filed and kept. These are the only public records that can show interior walls. They are open under FOIL, including copying, with narrow exceptions.
   - The **health department file**: septic and well records; the as-built plan shows the approved bedroom count and site layout.
   - **Condominium floor plans**: filed with the county clerk by law, showing unit layout and approximate dimensions.
3. **How a member of the public gets them:** the card from the town or city assessor (online in some places, by email or FOIL elsewhere); plans by FOIL request to the town, city or village; septic records by FOIL or a records form to the county health department; condo plans from the county clerk.
4. **For a typical older Hudson Valley house, expect an outline, not a layout.** Interior layout will usually have to be captured on site (phone LiDAR scan, 10 to 20 minutes) or traced from a floor plan the listing agent gives you.

---

## 2. Summary table

| Source | What it gives for one address | Interior layout | Photos | How reached | Cost | Automated access allowed | Confidence |
|---|---|---|---|---|---|---|---|
| NYS Tax Parcel Centroids (state) | Year built, living area, beds, baths, kitchens, style, heat, lot size, values | No (counts only) | No | ArcGIS API, bulk file | Free | Yes (public service) | Verified (earlier report) |
| Assessor property record card (RP-3100 form) | Area by storey, rooms, beds, full and half baths, basement type, grade, condition, improvements with dimensions | Partly (exterior sketch and counts; sketch itself unverified on the blank form) | Sometimes | Assessor's office; some online | Free to view; copies up to $0.25/page | No statement; treat as web-only | Form verified; sketch content unverified |
| Dutchess ParcelAccess | Parcel outline and dimensions, parcel data, structure photos, filed maps, well reports, flood | No (sketch not mentioned) | Yes (assessor photos) | Web page | Free | No terms stated; no API | Info page verified; app not opened |
| Putnam County Imagemate | Property information plus a **scanned property card** under Documents | Partly (whatever the card holds) | Unverified | Web page, public access | Free | Not stated | Verified (county instructions PDF) |
| Image Mate Online / Beacon portals (Orange, Ulster, Columbia, Sullivan, Greene, Rockland) | Inventory, structures, tax maps, photos; sketch varies | Partly or no; per county | Often | Web page | Free (some paid tiers) | Not stated; ask county | Mostly unverified per county |
| Building department file (plans, permits, CO) | Whatever was filed: plans, plot plan, permit history, CO | **Yes, if plans exist** | Rarely | FOIL request; file review by appointment | $0.25/page; large sheets at actual cost | No (request only) | Law verified (COOG opinions); holdings vary |
| County health department (septic, well) | As-built septic plan, approved bedroom count, well completion report | Partly (footprint, bedroom count) | No | FOIL or records form; Dutchess well reports in ParcelAccess | $0.25/page (Dutchess) | No | Verified for Dutchess, Ulster, Westchester process |
| County clerk: condo floor plans | Unit layout, location, approximate dimensions | **Yes, condos only** | No | Clerk's office or document search | Per-page copy fee | Web-only, disclaimer | Statute verified; online availability unverified |
| County clerk: filed subdivision maps, surveys | Lot dimensions; sometimes house location | No | No | ParcelAccess (Dutchess), clerk search | Free to view | Web-only | Verified (ParcelAccess info page) |
| NYS Building Footprints | Roof outline polygon | No (outline only) | No | ArcGIS FeatureServer, 2,000 rows/request | Free | Yes (public service) | Verified (layer page) |
| NYS orthoimagery | Vertical aerial photo; Dutchess 2025, 2021, 2016, 2013, 2009, 2004 | No | Aerial | Web services, download app | Free | Yes (public service) | Verified (years); resolution unverified |
| Dutchess AerialAccess | Historic aerials back to 1936 | No | Aerial | Web viewer | Free | Not stated; no download described | Verified |
| NYS LiDAR and 1 m DEM | Point cloud; building height can be derived | No | No | Download app, FTP | Free | Yes | Verified (pages); processing needed |
| CRIS (state historic office) | Inventory forms, National Register nominations, survey reports, photos | Rarely (old plans in nominations) | Yes | Web application | Free | Not stated | Verified (description page) |
| HABS/HAER/HALS (Library of Congress) | Measured drawings, photos, histories for about 43,000 sites nationwide | **Yes, for the few houses surveyed** | Yes | Online catalog | Free | Yes (LoC is open); rights unverified | Verified holdings |
| Mapillary | Street-level photos, where someone drove | No | Yes | API with registration | Free | Yes, within terms; CC BY-SA; attribution | Verified (terms page) |
| Google Street View | Street-level photos, wide coverage | No | Yes (display only) | Paid API | Per request; free monthly cap | Yes via API; only pano ID may be cached | Verified (service terms, archived June 2026) |
| Listing sites (Zillow, Redfin, Realtor.com) | Photos, sometimes floor plan and room sizes | Sometimes | Yes | A person in a browser | Free | **No** | Redfin verified; others unverified |
| OneKey MLS | Listing media and fields | Sometimes | Yes | Through a participant broker | Broker relationship | Only under licence | Verified (rules ver. 2024E) |
| RentCast, ATTOM, Regrid, HouseCanary | Room count, beds, baths, storeys, features | **No** | No | API | Free tier to sales-led | Yes, under contract | Verified schema (RentCast); others partly |
| Phone LiDAR scan (RoomPlan apps) | Walls, doors, windows, openings, objects, per storey | **Yes** | Own photos | Owner on site | Free to modest | Yes (your own data) | Verified (Apple docs) |

---

## 3. Detail by topic

### 3.1 Assessor property record cards

**What the card holds.** The state form is RP-3100, "Residential, Farm and Vacant Land Property Record Card". I read the blank form. It has these fields: number of rooms, bedrooms, full baths, half baths, kitchens, fireplaces, number of storeys; a building-area section with separate lines for 1st storey, 2nd storey, additional storey, half storey, three-quarter storey, finished attic, finished basement, finished rec room, finished and unfinished area over garage, and total living area; basement type; construction grade and condition; an improvements table with two dimensions and square feet per item (porches, decks, garages, sheds, pools). Verified: https://tax.ny.gov/pdf/publications/orpts/manuals/residential_prc.pdf

- Room counts are for the whole house, **not by floor**. Area is by floor.
- **Sketch.** The text I could read shows no sketch block. The drawing area may not survive text extraction. Assessors in New York commonly keep an exterior sketch with wall lengths on the card or in the assessment software. This is **unverified** as a general rule; it varies by town. Where it exists it is an outside outline by section (main block, wing, porch), measured to about a foot. It never shows interior walls.
- The earlier report's parcel centroid file already has: year built, living area, beds, full baths, kitchens, style, heat. It does **not** have: half baths, area by storey, basement, garage, grade, condition, room count. Those are on the card or the county portal only.

**Which counties show it online.**

| County | Portal | Sketch or card online | Confidence |
|---|---|---|---|
| Dutchess | ParcelAccess | Structure photos yes. Sketch and record card are **not mentioned** on the info page. | Verified absence on info page; app not opened |
| Putnam | Imagemate plus E-Parcel map | Yes: a **scanned property card** sits under "Documents". Cards were scanned in summer 2024; later changes show under "Parcel History". Public access button, no login mentioned. | Verified: https://www.putnamcountyny.gov/images/Departments/Real_Property_Tax/PDF_Documents/Search%20Instructions%20-%20Real%20Property%20Web%20Page%20NO%20IQSpcny.pdf |
| Sullivan | "Beacon" portal has replaced Image Mate Online | Shows location, acreage, structures, purchase dates, taxes, maps, aerial photos. Sketch not stated. | Verified: https://www.sullivanny.gov/node/5177 |
| Ulster | Image Mate Online, moving to a Beacon portal | Unknown | Earlier report; not re-opened |
| Orange | Image Mate Online | Unknown | Unverified |
| Columbia | Image Mate Online (columbia.sdgnys.com) | Unknown | Earlier report |
| Greene, Rockland | County viewers | Not researched | Unverified |
| Westchester | By municipality. Croton-on-Hudson: record cards can be downloaded online. Yorktown: by email request to the assessor, reply in 1 to 2 business days; the card also notes septic information. Yonkers and Cortlandt have their own search portals (not opened). | Varies | Verified for Croton (https://www.crotononhudson-ny.gov/village-engineer/faq/are-property-record-cards-available-online) and Yorktown (https://www.yorktownny.gov/town-departments/assessor/request-for-property-record-card/) |

Note on what a portal can hold: Tompkins County (outside our area) states that its Image Mate "Advanced" tier includes photos, **sketches** and surveys, and limits that tier to the professional real-estate community. So the software can serve sketches; each county decides whether the public sees them. Verified: https://tompkinscountyny.gov/node/775

**Where it is not online.** The card is an agency record. Ask the town or city assessor by email or in person; if refused, file a FOIL request with the municipality's records access officer. In Dutchess, assessment data is kept by the municipal assessors, not the county (verified on the ParcelAccess info page: https://gis.dutchessny.gov/parcelaccess/additional-info). I did not find a Committee on Open Government opinion specifically on record cards in the part of the index I could read; the index has an "Assessment Information" heading with 14 opinions that I did not open.

**Terms on automated access.** None of the county pages I read states any. Image Mate and Beacon are vendor-hosted web applications with no API. Treat them as pages a person opens. I could not read their robots files.

### 3.2 Building department files

**Are they public?** Yes. The Committee on Open Government (COOG) has said so repeatedly. All opinions below are verified on the Committee's own site.

| Opinion | Date | What it says |
|---|---|---|
| FOIL-AO-7675 | 29 Apr 1993 | Town of Greenburgh refused plans without the owner's permission. COOG: plans "clearly constitute 'records'" under FOIL; the owner cannot control disclosure; the agency must give a copy on payment of the fee. An architect's seal "does not serve as a copyright, nor does it restrict the right to inspect and copy." https://docsopengovernment.dos.ny.gov/coog/ftext/f7675.htm |
| FOIL-AO-7921 | 20 Oct 1993 | Town of New Castle barred copying without owner consent, citing privacy and security. COOG: "building plans per se contain no personal information concerning an individual", so the privacy exemption does not apply; owner preference is "irrelevant"; details of alarms or security systems might be withheld under section 87(2)(f). https://docsopengovernment.dos.ny.gov/coog/ftext/f7921.htm |
| FOIL-AO-11971 | 23 Feb 2000 | A town may not forbid viewing or copying of building or architectural plans. Copying for a non-commercial purpose would likely be fair use. Large sheets were copied as letter-size pieces to be joined. https://docsopengovernment.dos.ny.gov/coog/ftext/f11971.htm |
| FOIL-AO-12830 | 24 Jul 2001 | Plans can be copyrighted, but the Copyright Act is not a "nondisclosure" statute. An agency may refuse to **copy** only if reproduction "would cause substantial injury to the competitive position" of the copyright holder (section 87(2)(d)). The agency bears no liability for later use; any claim is between the copyright holder and the recipient. https://docsopengovernment.dos.ny.gov/coog/ftext/f12830.htm |
| FOIL-AO-15073 | 27 Dec 2004 | Asked by the **Town of Wappinger** attorney. Same conclusions for plot plans, plats, site plans and stamped drawings: "Whether the owner of property consents to permit access to a building plan is irrelevant." Unless an exception applies, the agency must permit inspection and copying of a copyrighted work. https://docsopengovernment.dos.ny.gov/coog/ftext/f15073%20.htm |
| FOIL-AO-18986 | 13 Nov 2012 | On "sensitive" buildings in New York City: the security exemption turns on the degree of detail; a blanket rule requiring owner consent is too broad. https://docsopengovernment.dos.ny.gov/coog/ftext/f18986.html |

Plain summary of the position:
- **Access:** presumed open. Reason for asking and identity of the requester do not matter.
- **Privacy:** not a ground for withholding house plans.
- **Security:** only specific parts (alarm and security system details) may be redacted.
- **Copyright:** does not block inspection. It can limit copying only where copying would substantially harm the architect's competitive position. What you do with a copy afterwards is your own copyright question. Using an old plan to model your own remodel of that same house is a different thing from building a second house from it. Ask a lawyer before any reuse beyond study.
- These are advisory opinions. Towns still sometimes refuse; the opinions are what you cite in an appeal.

**Do the plans exist?** This is the real limit, more than the law.
- Houses built before a town had a building code have no plans on file. Many Hudson Valley houses are in this group.
- Small alterations are often filed with a hand sketch or nothing.
- Retention: the state schedule for local government records (LGS-1) sets how long plans must be kept. I could not open the building section. Whether a town may discard one- and two-family house plans after a few years is **unverified**; ask the building department what it holds before paying for a search.
- The Town of Poughkeepsie requires two sets of plans and two plot plans with a permit application; the department keeps one set. Verified: https://www.townofpoughkeepsie-ny.gov/m/faq?cat=16

**How to request.**
1. Find the parcel's municipality (town, city or village; a village inside a town has its own building department).
2. Call or email the building department first. Ask: what is in the file for this address (permits, CO, plans, plot plan, survey)?
3. Send a FOIL request to the municipality's records access officer (usually the clerk). Name the address and tax parcel number. Ask for "the complete building department file including all plans, drawings, permits, certificates of occupancy and surveys". Ask for electronic copies by email.
4. Many towns will let a buyer review the file by appointment. Wappinger says so on its page.

**Cost and time.** Dutchess County's own FOIL page gives the standard terms: acknowledgement within five business days; $0.25 per page; inspection in person is free; electronic records at the actual cost of the media; staff time may be charged if a request takes over two hours; appeal within 30 days of a denial. Verified: https://www.dutchessny.gov/County-Government/Dutchess-County-Government-FOIL-Request.htm . Towns follow the same statute. The statute's outer time limits (about 20 business days after acknowledgement, or a stated date) and the "actual cost" rule for large-format sheets are **unverified** here because I did not open the statute. Realistic time: a few days to four weeks.

**Online portals, municipality by municipality.**

| Municipality | What I found | Confidence |
|---|---|---|
| City of Poughkeepsie | Permit forms page (cityofpoughkeepsie.gov/286/Permits-Forms). No public permit lookup found. | Secondary (jaspector.com directory); city site not opened |
| Town of Poughkeepsie | FAQ and a FOIL Requests page. No portal named. Building Dept 845-485-3655. | Verified (FAQ page) |
| City of Beacon | PDF application forms; bills paid through a Munis self-service site. No records portal. Building Dept 845-838-5020. | Verified: https://beaconny.gov/index.php/departments/building-department/ |
| Town of Fishkill | Forms and fee schedule only. No portal named. | Verified: https://www.fishkill-ny.gov/buildingfirezoning.html |
| Town of Wappinger | A "Public Records Access" link to a **Laserfiche** portal; file review by appointment; buyers can request parcel history by FOIL form. What the Laserfiche portal holds for building files is not stated. | Verified: https://townofwappingerny.gov/building-department/ |
| Town of East Fishkill | **OpenGov** portal for permit applications, with drawing upload: https://eastfishkillny.portal.opengov.com/ . Whether the public can search permits or see documents by address is not stated. | Verified: https://eastfishkillny.gov/new-east-fishkill-on-line-permit-portal/ |
| Town of Hyde Park | Forms and applications page only. | Secondary |
| City of Newburgh | No named portal. Bureau of Code Compliance. | Secondary |
| City of Kingston | An online permit portal (hosted at citysquared.com), an "Online Property Information System" (kingston-ny.gov/propertylookup), and "M5 Permit Reports". Contents not described on the page. | Verified links: https://kingston-ny.gov/building |
| City of Middletown | No named portal. | Secondary |

**Correction to the earlier report.** It said no municipal permit data was published. That is too strong. East Fishkill (OpenGov), Wappinger (Laserfiche) and Kingston (permit reports and property lookup) publish something. None was confirmed to show plans by address. Each needs a five-minute check by hand.

### 3.3 Health department records (septic and well)

Why they matter: the septic system is sized by bedroom count, and the as-built drawing shows the house on the lot. A mismatch between approved bedrooms and listed bedrooms is a common flip problem.

| County | What is online | How to request | Confidence |
|---|---|---|---|
| Dutchess | **Well reports** appear in ParcelAccess (source: county Department of Health). Septic files are not online. | County FOIL process with the health department's own "Application for Access to the Department of Health's Records" form. $0.25/page. Environmental Health Services: ehs@dutchessny.gov, 845-486-3404. | Verified: ParcelAccess info page; https://www.dutchessny.gov/County-Government/Dutchess-County-Government-FOIL-Request.htm ; https://www.dutchessny.gov/Departments/DBCH/Building-Permits-Certificates-Occupancy-Lot-Approval.htm |
| Ulster | Nothing online found. | FOIL form emailed to doh-foil@ulstercountyny.gov. Fees and time not stated. | Verified: https://www.ulstercountyny.gov/Departments/Health/About/Health-FOIL |
| Orange | Nothing found. | Unknown. | Unverified |
| Westchester | Nothing online, but a dedicated request form. It returns, if on file: certificate of construction compliance, **as-built plan showing approved bedrooms**, well completion report, design data sheet, property card. Needs section/block/lot and year built. The form warns that houses built before 1950 often have no record and that well data starts in the late 1960s. | Email DOH-BEQ@WestchesterCountyNY.gov | Verified: https://health.westchestercountyny.gov/images/stories/Environmental%20Forms/Sketch%20Request%20Form%20Revised%2012%2008%202025.pdf |

Dutchess also ties septic approval to building permits: before a certificate of occupancy, the health department confirms a valid approval and an acceptable well completion report (verified, same Dutchess page). So newer Dutchess houses on septic should have a file.

### 3.4 County clerk filings that carry drawings

- **Condominium floor plans.** Real Property Law section 339-p requires floor plans to be filed with the recording officer at the same time as the declaration. They must show the "layout, locations, and approximate dimensions of the units" and carry a verified statement from a registered architect or licensed engineer that they match the plans approved by the municipality. Verified: https://nysenate.gov/legislation/laws/RPP/339-P . For any condo unit this is the best public source. Whether Dutchess shows them as images in its online document search or only at the counter is unverified.
- **Filed subdivision maps.** Lot lines and dimensions, sometimes building envelopes and septic areas. Dutchess ParcelAccess links filed maps from the clerk (verified on the info page).
- **Surveys.** New York deeds usually describe the lot by metes and bounds and seldom attach a survey. A survey showing the house is more often in the building department file or held by the owner or title company. Unverified, general knowledge.
- **Co-ops** are not real property transfers and have no filed unit plans.

### 3.5 Statewide and federal geodata for one house

| Layer | What it adds | Access | Confidence |
|---|---|---|---|
| **NYS Building Footprints** | Outline polygon of each building. Sources: NYSERDA (most of the state), NYC Open Data, Microsoft (gap filler), state Geospatial Services. Fields: county, municipality, source, source type (orthoimagery or LiDAR), source date. No height or address field. | `https://nysgeohub.ny.gov/arcgis/rest/services/Basemap/NYS_Building_Footprints/FeatureServer/1`; query, JSON/GeoJSON/PBF; 2,000 rows per request. No licence text on the layer. | Verified (layer page) |
| Microsoft Global ML Building Footprints | Same kind of outline; some height estimates. Licence is on the GitHub repository (ODbL per general knowledge). The state layer already includes it where needed. | Bulk files | Secondary; licence unverified |
| **NYS orthoimagery** | Aerial photo to check the outline, additions, decks, roof shape. Dutchess, Orange, Ulster: 2025 (and a partial 2025 summer flight), 2021, 2016, 2013, 2009, 2004. | Web services at orthos.its.ny.gov (WMS-style MapServer per year and "Latest"); downloads through the Discover GIS Data NY application. Resolution and licence not stated on the page. | Verified: https://gis.ny.gov/orthoimagery |
| Dutchess AerialAccess | Historic aerials from 1936 on. Useful to date additions. View only. | https://gis.dutchessny.gov/aerialaccess/ | Verified |
| Oblique imagery | St. Lawrence County's portal links to Pictometry views. Not confirmed for any Hudson Valley county. Pictometry (EagleView) imagery is licensed, not open. | Viewer only | Secondary; unverified locally |
| **LiDAR and DEM** | 1 m bare-earth DEM statewide. Classified LAS point clouds; a 2014 three-county set (Ulster, Dutchess, Orange) is listed, and a 2022 four-county set (Dutchess, Orange, Rockland, Ulster) appears in NOAA's catalogue. Height of a house = first-return surface minus ground. Needs point-cloud processing. | Discover GIS Data NY app; FTP | Verified: https://gis.ny.gov/lidar and https://gis.ny.gov/elevation/ ; 2022 set secondary |
| FEMA flood layers | See earlier report (NFHL layer 28). | API | Verified earlier |
| USDA soils (SSURGO) | Soil type, drainage, depth to water table: bears on septic and wet basements. | Web Soil Survey, Soil Data Access | Unverified today |
| **CRIS** (State Historic Preservation Office) | Inventory forms, National Register nominations, survey reports, photographs; over 1.5 million scanned pages. Nominations for individual houses sometimes include floor plans. | https://cris.parks.ny.gov/ (web application). No terms stated on the description page. | Verified: https://parks.ny.gov/preservation/resources/cris |
| **HABS/HAER/HALS** | Measured drawings, large-format photos and written histories for about 43,000 structures and sites nationwide; over 38,600 online records. A real floor plan if the house was surveyed. Few private houses were. | Library of Congress online catalog, keyword search. Rights statement not on the page I read; these are generally federal works. | Holdings verified: https://www.loc.gov/collections/historic-american-buildings-landscapes-and-engineering-records/about-this-collection/ ; rights unverified |

Use: the footprint polygon plus the orthophoto gives a scaled outline automatically. Roof outlines include eaves and porches, so expect about half a metre to a metre of error (unverified estimate).

### 3.6 Photos that are lawful to store

| Source | Fetch | Display | Keep | Cost | Confidence |
|---|---|---|---|---|---|
| The owner's own photos | Yes | Yes | Yes | Free | — |
| State and county orthoimagery | Yes | Yes | Yes (public services; no licence text found; state asks "as is" use) | Free | Verified services exist; licence not stated |
| Assessor photos (ParcelAccess, Image Mate) | By hand only. No API; no terms permitting automation. | Private use | A hand-saved copy of a public record photo for your own file is low risk; ask the county before any automated collection. Under FOIL the photo is a record you can also request. | Free | Verified that photos exist; terms not stated |
| **Mapillary** | Yes, through the API after registering an application. No scraping or robots outside published interfaces. | Yes, with attribution (Mapillary logo and link; image credit) | Yes: the terms cover "downloading individual images and serving them from your own servers" with attribution. Images are CC BY-SA. No attempts to unblur or re-identify people or plates. Commercial use is limited to listed purposes. | Free | Verified: https://mapillary.com/legal and https://help.mapillary.com/hc/en-us/articles/115001770409-Licenses |
| **Google Street View** | Yes, through the Street View Static API or an embed | Yes, inside the app at view time | **No.** The service terms allow caching only the `pano_ID`. The mode should store the pano ID and heading, and re-request the image each time. Using the images to extract data (tracing, measuring, model training) is restricted by the main agreement, which I did not open. | Pay as you go per 1,000 requests with a free monthly cap per SKU (10,000 for Essentials-class SKUs). The exact Street View price was not readable today. | Terms verified on the archived 10 June 2026 version: https://cloud.google.com/archive/maps-platform/terms/maps-service-terms-20260610 ; pricing structure verified: https://developers.google.com/maps/billing-and-pricing/pricing |
| KartaView | Owned by Grab. Images CC BY-SA 4.0. No batch download option as of 2020. Sparse coverage. | With attribution | Yes under the licence | Free | Secondary (OpenStreetMap wiki) |
| Bing Streetside | The Bing Maps for Enterprise licensing page now redirects to Azure Maps. Bing Maps is being retired. Not a usable route. | — | — | — | Redirect observed; retirement dates unverified |
| Listing photos | See 3.7 | | | | |

Practical point: Mapillary coverage on rural Dutchess roads is patchy (unverified). Street View covers nearly every road but cannot be stored. The owner's own drive-by photo is the only street photo that is always storable.

### 3.7 Listing floor plans and photos

**What the rules say.**
- **Redfin** (terms updated 29 September 2025, verified: https://www.redfin.com/about/terms-of-use): "You may not automatedly crawl or query the Services for any purpose or by any means" without prior written permission. The MLS section expressly bans "scraping" and data mining. Information is "intended for your personal, non-commercial use." Users agree not to "copy, redistribute, or retransmit" it.
- **Zillow, Realtor.com**: I could not open their terms pages. They are widely reported to ban automated access in similar words. **Unverified.** Read them by hand.
- **OneKey MLS Rules and Procedures, version 2024E** (verified: https://support.onekeymls.com/hc/en-us/article_attachments/33160192924052):
  - Rule 602.2: rights in the MLS compilation stay with the MLS.
  - Rule 604: listing information is confidential and for participants' use.
  - Rule 605.1: a participant may reproduce from the compilation and **distribute to prospective purchasers or tenants**. Rule 605.3 and 605.4: no transmission to unauthorised persons; any other use is prohibited.
  - Rule 612.2: no use of another participant's photographs without consent.
  - Rule 704 and 708: IDX listings are for display only; no part of the database may be passed on.
  - Rule 717: IDX information is "exclusively for consumers' personal, non-commercial use."
  - Rule 805 (VOW sites): operators must monitor for and prevent "scraping".
  - Rule 306.3: a listing may include "Floor Plans" as an attachment. So floor plans exist in the MLS when the listing agent uploaded one. There are no structured room-dimension fields confirmed.
- Listing photos and floor plans are also copyrighted works of the photographer, agent or MLS.

**Lawful routes.**
1. **Ask the listing agent.** Under Rule 605.1 an agent may give listing material to a prospective purchaser. Ask for the floor plan PDF, the photo set, the survey and the seller's disclosure. This is the cleanest route and costs nothing. Keep the email as your record of how you got it.
2. **View and take notes.** Viewing a listing in a browser for your own purchase decision is the intended use. The mode should store the listing URL, your own notes and your own measurements. Saving copies of the photos or plan by hand for private study is common, but the Redfin terms do not expressly grant it, and a fix-and-flip business is a commercial purpose. Do not redistribute, and do not build a library of saved listing media.
3. **A broker relationship.** A licensed agent in the family, or a buyer's agent, has MLS access. Use is limited to the activities the licence covers (Rule 202.2). A data feed needs an MLS Grid licence through a participating broker (see earlier report: $250 a month plus $20 per licence).
4. **Licensed data providers.** I found no provider that sells per-address floor plans or room dimensions for arbitrary houses at low volume. The property APIs in 3.8 carry counts only. Unverified as an absence.
5. **Your own capture** (3.9). The result is yours.

Do not use scraper services (Apify actors, RapidAPI "Zillow" wrappers). They are not licensed by the sites.

### 3.8 Paid or free APIs for one-address lookups

| Provider | Room-level or sketch data | Low-volume price | Terms | Confidence |
|---|---|---|---|---|
| **RentCast** | No. `features.roomCount`, `floorCount`, `unitCount`, garage, heating, cooling, roof, foundation, exterior, plus beds, baths, square footage, year built, sale and tax history. No room dimensions, plans, sketches or photos. | 50 requests a month free; paid plans monthly with per-request overage; only HTTP 200 responses billed | Storage terms not on the pages read | Verified: https://developers.rentcast.io/reference/property-data-schema and https://developers.rentcast.io/reference/billing-and-pricing |
| **ATTOM** | No. Total rooms, bedrooms, full and partial baths, building area, garage area, and coded features (building shape, flooring, foundation, porch, roof). 177 columns. No sketch, plan, per-floor area or photos mentioned. | Sales-led; "flexible pricing" | Not read | Verified: https://cloud-help.attomdata.com/article/497-property-characteristics |
| **Estated** | Acquired by ATTOM; sold as ATTOM's Property Data API. No public prices. | — | — | Verified: https://estated.com/ |
| **Regrid** | No rooms. Parcel boundary, owner, address, zoning, and **building footprints linked to parcels**. Useful for Dutchess, where the state does not publish parcel polygons. | Monthly self-serve plans up to 10,000 records; prices not on the page; 30-day free sandbox | "API / Tiles Terms of Service" apply; not read | Verified: https://regrid.com/api |
| **HouseCanary** | Not shown. "75+ data points" per property; valuations and risk. A basic plan at $19 a month is mentioned on its blog. | $19 a month entry (blog) | Not read | Verified blog only: https://www.housecanary.com/blog/real-estate-api |
| CoreLogic (Cotality), First American DataTree | Enterprise products. Assessor-derived characteristics; some assessor sketch vectors are said to exist in enterprise appraisal products. | Sales-led | Contract | **Unverified**; not opened |

Conclusion: these APIs repackage assessor data. For New York the state centroid file already gives most of it free. None gives a layout. Regrid is the only one that adds geometry.

### 3.9 Capturing a layout without records

The owner will often be standing in the house. This is the most reliable route.

**Apple RoomPlan** (verified: https://developer.apple.com/documentation/roomplan/capturedroom.md)
- iOS and iPadOS 16 and later. Needs a LiDAR device (iPhone Pro models from 12 Pro, iPad Pro); device list unverified today.
- A scan returns a `CapturedRoom`: arrays of `walls`, `doors`, `windows`, `openings`, `floors` (each a `Surface` with dimensions and a transform), `objects` (3D boxes with a category, such as cabinets, appliances, toilets, tubs, sinks, stairs), `sections` (room types), and a `story` number.
- `CapturedRoom` is `Encodable` and `Decodable`. An app can write it as **JSON**. It also exports **USDZ** with options for parametric, mesh or model output.
- A `CapturedStructure` type merges several rooms into one building model.
- Apple publishes no accuracy figure that I found.

**Accuracy evidence.**
- Polycam (a LiDAR app vendor) states "a standard accuracy of +/-½ inch on standard interior captures"; wall-to-wall distances land about half an inch to two inches from a laser measure. Vendor claim. Verified: https://learn.poly.cam/hc/en-us/articles/50434745985556-How-Accurate-Are-Polycam-Scans
- A 2026 TU Delft thesis compared RoomPlan (iPhone 12 Pro) with terrestrial laser scans of three rooms. One room showed an average deviation of about 10 to 13 cm; one model came out about 0.9 m short along one side; a window was missed in another; nearby windows were sometimes merged; wall height was wrong where the ceiling was not seen. Verified: https://3d.bk.tudelft.nl/ken/files/26_giorgos.pdf
- Working expectation: 1 to 5 cm on a single clear room; larger drift across a whole house; occasional gross errors. Check two or three long dimensions with a laser measure.

**Apps and what they export.**

| Tool | Capture | Exports | Cost | Confidence |
|---|---|---|---|---|
| **magicplan** | Phone, LiDAR supported | Sketch as **SVG**, PDF, JPG, PNG, **DXF** (without dimensions); 3D as **IFC**, OBJ, USDZ; statistics as CSV; estimate as PDF or XLS | Plan prices not read | Verified: https://help.magicplan.app/export-formats |
| **Polycam** | Phone LiDAR | 3D: GLTF free; OBJ and USDZ on paid plans; LAS on Business. Floor plans as PDF, PNG, **SVG**, CSV and **DXF** on Business or Enterprise. E57 not supported. | Paid for plan exports | Verified: https://learn.poly.cam/hc/en-us/articles/27756102599572-What-File-Types-Can-Polycam-Export |
| **CubiCasa** | Any smartphone, walk-through video; plan returned in about 24 hours | Formats not confirmed | Free basic scans in the US; add-ons from $9.99 | Secondary (softwareadvice.com) |
| **Matterport** | 360 camera or phone | Schematic floor plan as JPG, PNG, **SVG**, PDF; MatterPak with OBJ, coloured point cloud, ceiling plan; E57; BIM file | Add-ons priced per space; plan page not opened | Verified: https://matterport.github.io/showcase-sdk/modelapi_ordering_addons.html |
| **Zillow 3D Home** | Free app; an interactive floor plan needs a supported 360 camera (Ricoh Theta, Insta360) | No export of plan or panoramas mentioned; share by link or embed | Free | Verified: https://www.zillow.com/3d-home/faq/ |
| A small own app on RoomPlan | LiDAR iPhone | The raw `CapturedRoom` JSON and USDZ, with no vendor in between | Development time | Verified API |

**Formats a tool could read.**
- **RoomPlan JSON**: best fit. Already walls, openings and objects with sizes and transforms. Project to 2D by dropping the vertical axis.
- **SVG** and **DXF**: 2D lines. Easy to draw, but walls and doors arrive as unlabelled geometry unless the exporter uses layers.
- **IFC** (the open building-model standard): walls, doors, windows, spaces as typed objects. Heavy to parse; open-source readers exist.
- **USDZ / glTF**: 3D meshes or boxes. Good for viewing, awkward for a 2D plan.
- **Images and PDFs** of a plan: need tracing by a vision model plus one known dimension for scale. Expect 5 to 10 percent error (unverified estimate).

### 3.10 Data model for an editable 2D plan, and cost data

**Existing open models.**

| Model | Fit | Confidence |
|---|---|---|
| RoomPlan `CapturedRoom` JSON | Good input format; Apple-defined, not a general standard | Verified |
| IFC (buildingSMART) | Complete and standard; too heavy as the working format; good as an export | Unverified today |
| FloorspaceJS (US national lab, for OpenStudio) | Open-source 2D editor with a custom JSON file format, one plan per storey; windows are placed on edges. Built for energy models, not kitchens. | Verified description: https://natlabrockies.github.io/floorspace.js/docs ; licence not stated there |
| Sweet Home 3D, react-planner, arcada, OpenPlans | Open-source plan editors with their own formats | Seen in search only; unverified |

**Recommendation: a small own JSON model, with importers.** None of the above is both simple and remodel-aware. A model an agent can edit by instruction needs only this:

- `levels`: one per storey, with elevation and ceiling height.
- `vertices`: points in millimetres.
- `walls`: start vertex, end vertex, thickness, kind (exterior or interior), `bearing` (yes, no, **unknown**), `source` (footprint, assessor sketch, scan, traced plan, tape) and `confidence`.
- `openings`: wall id, offset along the wall, width, height, kind (door, window, cased opening), swing.
- `rooms`: ordered wall ids, name, use. Area is computed, never stored.
- `fixtures`: kind (base cabinet, wall cabinet, sink, range, refrigerator, toilet, tub, stair), size, position, rotation, wall it is attached to, and whether it needs plumbing, gas or a vent.
- `changes`: an ordered list of edits against the as-is plan (remove wall, add wall, move fixture, widen opening). The proposed plan is the as-is plan plus the changes.

Why this shape: SVG rendering is a direct walk over walls, openings and fixtures. Dimensions are computed from vertices. The change list gives a demolition list and a new-work list, and each change maps to cost lines. The `bearing: unknown` flag makes the tool say "check with an engineer" instead of pricing a wall removal as if it were a partition. `source` and `confidence` let the plan mix an accurate scanned kitchen with a guessed upstairs.

**Cost data.**
- **Cost vs. Value Report** (Zonda): free to download; average cost of about two dozen standard projects by region and city, including the Middle Atlantic region and New York-area markets. **Reuse rules are strict**: use "in any computer- or web-based application, calculator, database" needs permission from Zonda; excerpts are capped at five projects with a set credit line. Verified: https://www.jlconline.com/cost-vs-value/2025/re-use-and-licensing-guidelines . A private tool may point to it; it should not load the table without asking.
- **RSMeans, Craftsman estimator books, Xactimate**: paid, licensed price books with location factors. Unverified today.
- **magicplan** can produce an estimate from a plan and a price list (verified export list above).
- **Open data**: I found no open, reusable unit-cost dataset for residential remodelling in New York. Public-domain inputs that help: federal wage statistics by trade for the Poughkeepsie-Newburgh-Middletown and Kingston areas, and retailer list prices for materials. Unverified today.
- **Practical answer**: keep an own price book. A table of items (remove non-bearing partition per linear foot, new opening with header, base cabinet per linear foot, relocate sink, LVP per square foot), each with low and high figures, a date and a source (own contractor quote, own past job). Seed it from the two prior remodels and update it from each quote. This is more accurate for Dutchess than any national table and has no licence problem.

---

## 4. What a mode can fetch, link to, or must request

**Fetch by itself (public services or files, no terms problem found)**
- State parcel centroid record: year built, living area, beds, baths, kitchens, style, heat, lot size, values, deed book and page.
- NYS building footprint polygon for the house.
- NYS orthoimagery tile for the lot (current and earlier years).
- NYS DEM, and LiDAR tiles if height is wanted.
- FEMA flood zone at the point.
- Mapillary street-level images through its API, with attribution, where coverage exists.
- Google Street View through the paid API, **display only**; store the pano ID, not the image.
- Geocoding (Census, NYS).
- HABS/HAER catalog search at the Library of Congress.

**Link to only (a person opens it; no API, no permission for automation)**
- Dutchess ParcelAccess: assessor photos, parcel dimensions, filed maps, well reports.
- Image Mate Online, Beacon and Putnam Imagemate pages: inventory, photos, scanned property card.
- Dutchess AerialAccess historic aerials.
- County clerk document search: deeds, filed maps, condo declarations.
- CRIS historic resource records.
- Municipal portals: East Fishkill OpenGov, Wappinger Laserfiche, Kingston property lookup and permit reports.
- Listing pages on Zillow, Redfin, Realtor.com, OneKey. Store the URL and the owner's notes.
- Cost vs. Value report.

**Needs a records request or a person**
- Property record card with sketch, where not online: municipal assessor (email, then FOIL).
- Building department file: plans, permits, certificate of occupancy, survey. FOIL to the town, city or village.
- Septic as-built, approved bedroom count, well completion report: county health department.
- Condominium floor plans, where not viewable online: county clerk.
- Listing floor plan, photo set, survey, disclosure: the listing agent.
- The mode can draft each request with the address, parcel number, the right office and the COOG opinions to cite. It should track date sent, the five-business-day acknowledgement, and the reply.

---

## 5. Recommended design for getting a layout into the mode

Ordered by effort for the owner. Each step refines the same plan file. Every wall keeps its source and confidence.

| Step | Owner effort | What the mode does | Result | Expected accuracy |
|---|---|---|---|---|
| 1. Address only | None | Geocode; pull centroid facts, footprint polygon, orthophoto, flood zone. Draw the outline to scale. Show living area, storeys, beds and baths as constraints. Give links to ParcelAccess or the county portal. | A "shell": outline, no rooms | Outline within about 0.5 to 1 m; no interior |
| 2. Record card | Two minutes: open the portal, save or photograph the card, drop it in | Read the card: area by storey, room counts, basement, sketch dimensions. Correct the outline to the assessor's wall lengths. Split storeys. | A dimensioned shell per storey | Exterior within about a foot; interior still unknown |
| 3. Plan from the agent | One email to the listing agent | Trace the floor plan image into walls, openings and fixtures. Scale it from one known dimension or from the shell. Flag every traced wall as low confidence. | A rough full layout | 5 to 10 percent on room sizes; door and window positions approximate |
| 4. On-site scan | 10 to 20 minutes with a LiDAR iPhone | Import RoomPlan JSON (own small app), or SVG/DXF/IFC from magicplan or Polycam. Align to the shell. Replace traced walls with scanned ones. Add the owner's photos per room. | An as-is plan good enough to sketch a remodel and take off quantities | About 1 to 5 cm per room; check long runs with a laser; expect the odd missed window |
| 5. Records requests | Three emails, then wait days to weeks | Draft and track FOIL requests to the building department, health department and assessor. When plans arrive, trace them and compare with the scan. | Permit history, legal bedroom count, any original plans, structural hints | Filed plans are dimensioned but may not match what was built |
| 6. Hand measure | An hour with a laser and paper | Accept typed or spoken dimensions room by room | Fallback where no LiDAR phone is at hand | 1 to 2 cm per dimension; slow |

Notes on the design:
- Step 1 is the only fully automatic step. Say so in the interface. Do not draw invented rooms inside the shell.
- Steps 2 and 3 need a vision model reading an image the owner supplied. Keep the image in the project folder with a note of where it came from.
- Step 4 gives the working plan. If the business scans every house it views, a small own capture app that saves raw RoomPlan JSON is worth building; until then magicplan's SVG or IFC export is enough.
- Records (step 5) answer questions a scan cannot: which work was permitted, how many bedrooms the septic allows, where the bearing lines were drawn. Start them on day one because they are slow.
- No record and no scan tells you which walls carry load. Keep `bearing: unknown` until someone looks at the framing.
- "Speaking with the home" works on the change list: "remove the wall between kitchen and dining" becomes a change entry, a redraw, and cost lines from the own price book with a low to high range.

---

## 6. Open questions and what to verify by hand

1. **Does ParcelAccess show an assessor sketch or record card?** The info page does not mention one. Open one parcel (a town hall will do) and look at every tab. Five minutes.
2. **Which Dutchess assessors keep sketches**, and will they email the card? Call the assessors of the target towns (Poughkeepsie, Hyde Park, Wappinger, Fishkill, East Fishkill, Beacon, City of Poughkeepsie).
3. **Orange and Ulster portals:** is there a sketch or card image in public access? Has Ulster finished its move to the Beacon portal?
4. **Building departments:** for each target town, what do they hold for one- and two-family houses, and for how many years back? Is the Wappinger Laserfiche portal searchable by address for building files? Does East Fishkill's OpenGov portal have public record search?
5. **LGS-1 retention** for residential plans: read the "Building and Property Regulation" section of the schedule.
6. **Dutchess health department:** is there a faster informal file search for buyers than FOIL? Ask Environmental Health Services.
7. **Dutchess County Clerk:** are condo floor plans and filed maps viewable as images in the online search?
8. **Zillow and Realtor.com terms:** read the current text on their own sites. I could not open them.
9. **robots.txt** for every site the mode will touch, including the county GIS hosts. I could not read any.
10. **Google Maps Platform main agreement:** the clauses on storing content and on deriving data from imagery. Also the current Street View price.
11. **NYS orthoimagery and footprint licence text:** the layers carry none. Read the gis.ny.gov disclaimer page.
12. **Mapillary coverage** on the roads you care about. Open the map and look.
13. **OneKey:** are there structured room-dimension fields in listings, or only a floor plan attachment? Ask an agent.
14. **Which LiDAR phone does the owner have?** RoomPlan needs a Pro-model iPhone or iPad Pro. Without one, step 4 becomes CubiCasa or step 6.
15. **Copyright on reuse of filed plans:** before reusing an architect's drawings beyond study of the house, ask a New York attorney.
16. **Enterprise data (Cotality, DataTree):** do they hold assessor sketch vectors for New York, and at what minimum contract? Probably not worth it; one sales call would settle it.

---

## 7. Sources

Opened today (verified unless noted):

- NYS ORPTS residential property record card RP-3100: https://tax.ny.gov/pdf/publications/orpts/manuals/residential_prc.pdf
- Dutchess ParcelAccess additional information: https://gis.dutchessny.gov/parcelaccess/additional-info
- Dutchess AerialAccess: https://gis.dutchessny.gov/aerialaccess/
- Putnam County real property search instructions: https://www.putnamcountyny.gov/images/Departments/Real_Property_Tax/PDF_Documents/Search%20Instructions%20-%20Real%20Property%20Web%20Page%20NO%20IQSpcny.pdf
- Sullivan County Beacon portal notice: https://www.sullivanny.gov/node/5177
- Tompkins County Imagemate (for what the software can serve): https://tompkinscountyny.gov/node/775
- St. Lawrence County Image Mate FAQ (for access tiers): https://stlawco.gov/sites/default/files/RealProperty/Imagemate/FAQ%202025.pdf
- Croton-on-Hudson record cards FAQ: https://www.crotononhudson-ny.gov/village-engineer/faq/are-property-record-cards-available-online
- Yorktown record card request: https://www.yorktownny.gov/town-departments/assessor/request-for-property-record-card/
- Committee on Open Government advisory opinions index: https://opengovernment.ny.gov/freedom-information-law-foil-advisory-opinions
- COOG opinions: f7675, f7921, f11971, f12830, f15073, f16494, f18986 at https://docsopengovernment.dos.ny.gov/coog/ftext/
- Dutchess County FOIL page: https://www.dutchessny.gov/County-Government/Dutchess-County-Government-FOIL-Request.htm
- Dutchess health department, permits and CO: https://www.dutchessny.gov/Departments/DBCH/Building-Permits-Certificates-Occupancy-Lot-Approval.htm
- Ulster health FOIL: https://www.ulstercountyny.gov/Departments/Health/About/Health-FOIL
- Westchester health sketch request form: https://health.westchestercountyny.gov/images/stories/Environmental%20Forms/Sketch%20Request%20Form%20Revised%2012%2008%202025.pdf
- Town of Poughkeepsie building FAQ: https://www.townofpoughkeepsie-ny.gov/m/faq?cat=16
- City of Beacon building department: https://beaconny.gov/index.php/departments/building-department/
- Town of Fishkill building: https://www.fishkill-ny.gov/buildingfirezoning.html
- Town of Wappinger code enforcement: https://townofwappingerny.gov/building-department/
- East Fishkill permit portal notice: https://eastfishkillny.gov/new-east-fishkill-on-line-permit-portal/
- City of Kingston building safety: https://kingston-ny.gov/building and https://kingston-ny.gov/content/12525/50357.aspx
- Real Property Law 339-p: https://nysenate.gov/legislation/laws/RPP/339-P
- NYS Building Footprints layer: https://nysgeohub.ny.gov/arcgis/rest/services/Basemap/NYS_Building_Footprints/FeatureServer/1
- NYS orthoimagery: https://gis.ny.gov/orthoimagery
- NYS LiDAR and elevation: https://gis.ny.gov/lidar and https://gis.ny.gov/elevation/
- CRIS: https://parks.ny.gov/preservation/resources/cris
- HABS/HAER/HALS: https://www.loc.gov/collections/historic-american-buildings-landscapes-and-engineering-records/about-this-collection/
- Mapillary terms and licences: https://mapillary.com/legal and https://help.mapillary.com/hc/en-us/articles/115001770409-Licenses
- Google Maps Platform service specific terms (archived 10 June 2026): https://cloud.google.com/archive/maps-platform/terms/maps-service-terms-20260610
- Google Maps Platform pricing: https://developers.google.com/maps/billing-and-pricing/pricing
- Redfin terms of use: https://www.redfin.com/about/terms-of-use
- OneKey MLS Rules and Procedures ver. 2024E: https://support.onekeymls.com/hc/en-us/article_attachments/33160192924052
- RentCast schema and billing: https://developers.rentcast.io/reference/property-data-schema and https://developers.rentcast.io/reference/billing-and-pricing
- ATTOM property characteristics: https://cloud-help.attomdata.com/article/497-property-characteristics
- Estated: https://estated.com/
- Regrid API: https://regrid.com/api
- HouseCanary blog: https://www.housecanary.com/blog/real-estate-api
- Apple RoomPlan CapturedRoom: https://developer.apple.com/documentation/roomplan/capturedroom.md
- Polycam accuracy and exports: https://learn.poly.cam/hc/en-us/articles/50434745985556-How-Accurate-Are-Polycam-Scans and https://learn.poly.cam/hc/en-us/articles/27756102599572-What-File-Types-Can-Polycam-Export
- TU Delft thesis on RoomPlan (2026): https://3d.bk.tudelft.nl/ken/files/26_giorgos.pdf
- magicplan export formats: https://help.magicplan.app/export-formats
- Matterport add-ons: https://matterport.github.io/showcase-sdk/modelapi_ordering_addons.html
- Zillow 3D Home FAQ: https://www.zillow.com/3d-home/faq/
- FloorspaceJS documentation: https://natlabrockies.github.io/floorspace.js/docs
- Cost vs. Value reuse guidelines: https://www.jlconline.com/cost-vs-value/2025/re-use-and-licensing-guidelines

Secondary sources used: jaspector.com permit directory pages (Poughkeepsie city, Hyde Park, Newburgh, Middletown); softwareadvice.com (CubiCasa); OpenStreetMap wiki (KartaView); tech.marksblogg.com (Microsoft footprints); NOAA InPort catalogue title (2022 four-county LiDAR).

Tried and not opened:

| Target | Result |
|---|---|
| Zillow terms of use | Not on the fetch allowlist; a third-party tracker has withdrawn its copy of the clause |
| Realtor.com terms of use | Not found in search results |
| Matterport plans and prices | Redirect to a page not on the allowlist |
| Bing Maps for Enterprise licensing | Redirects to Azure Maps; not followed |
| LGS-1 building section | Only the replacement-pages file opened; section not in it |
| Any `robots.txt` | Direct HTTP blocked |
| ParcelAccess, Image Mate, Beacon, clerk and municipal applications | Not opened by design (no automation of record sites) and not reachable |
| Orange, Rockland, Greene, Columbia assessor portals; Orange health department | Nothing usable found in search |
| City of Poughkeepsie, Hyde Park, Newburgh, Middletown official building pages | Not returned by search; directory pages used instead |
| ATTOM, Regrid, HouseCanary price lists; Street View per-request price | Pages reached do not show prices |
