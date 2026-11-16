# 0023: the home mode: look up a house, hold its plan, and sketch a remodel by talking to it

Status: requirements, agreed with the owner on 2026-11-16. Not designed, not built. It is built through forge, after the mail mode (`docs/adr/0014`). It replaces the market-data real-estate mode researched on 2026-11-15.

Research: `docs/research/2026-11-16-home-records-by-address.md`. Not legal advice.

## What the owner asked for

Given a home address, get everything publicly available about that house, including layout, measurements and photos. Then speak with the home and sketch how it is remodelled: remove a wall, move the cabinets here. The owner and his wife are planning a fix-and-flip business in Dutchess County.

## What is decided

- **Records.** The mode fetches by itself what may be fetched: the state's parcel facts, the building's outline from the state footprint data, state aerial imagery, elevation and flood data. For county parcel viewers, clerk searches, town permit portals and listing pages it gives the owner a link to open. It never collects from a listing site or a portal that forbids it.
- **Interior layout does not come from a public register.** None exists for ordinary houses. The building department's file may hold plans, obtainable by a records request; the assessor's record card has storey areas and room counts. The mode can draft a records request for the owner to send, and keeps what comes back.
- **The plan is built in layers.** Each wall and each measurement is tagged with where it came from and how sure it is: the automatic outline; the record card; a floor plan traced from an image the owner supplies; a room scan made on site.
- **The room scan is the main route.** The owner has an iPhone Pro, which has LiDAR. He will often be standing in the house.
- **Photos.** The assessor's exterior photo where a county publishes one, and photos the owner uploads. No listing photos are collected.
- **The sketch.** A 2D floor plan with walls, openings, fixtures and dimensions, redrawn after each change, with every version kept so before and after can be compared. Each change carries rough cost notes from a price book the mode keeps itself.
- **Honest flags.** A change that touches a wall is marked: whether it is structural is unknown and needs a professional. An estimated measurement is labelled as estimated. A cost note is labelled as rough.

## What is not decided

1. How a scan gets from the phone to the mode. A room-scan app that exports a plan the mode can read (the research names magicplan, which exports SVG, DXF and IFC, and Polycam, which exports SVG and DXF on a paid plan), or a small own app that saves the raw scan. On a local setup the file is dropped into the project folder; in the cloud version it is sent over the chat channel.
2. The plan's data model. The research recommends a small own model (rooms, walls, openings, fixtures, each with source and confidence, plus a list of changes) with importers, and standard formats only as exports.
3. Where the price book's numbers come from. The well-known published remodel cost data needs its publisher's permission for use in a tool.
4. Which counties come first. Dutchess is the business's focus.
5. How the mode splits into small modes behind interfaces: for example a records source per county or state, a plan store, the sketching skill, the cost notes.

## What it needs from the kit

- The store, for houses, plans, versions and photos.
- Files a mode may read from a folder the owner drops things into.
- A skill whose output is a change to a structured plan, checked by a script before it is accepted (walls still close, dimensions still add up, nothing overlaps).
- A way to show the owner a drawing. The kit has none today: a mode returns data, and a harness shows text. An SVG file written to the project is the first answer.
- Images as input to a skill, for tracing a floor plan. The kit has no notion of this today.

## Checks to do by hand before design

The research lists sixteen. The first four: whether Dutchess ParcelAccess shows a building sketch for a house; what a Dutchess town's record card looks like; one records request to a building department, to learn the time and cost; one scan of a real room with a candidate app, exported and opened.
