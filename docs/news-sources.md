# News sources and story workflow

How Firelands Current finds, checks and publishes local news. Read this before writing stories. Story fields and the media library are covered in [README.md](../README.md); code conventions are in [AGENTS.md](../AGENTS.md).

## Editorial rules

- **Write original reporting.** Take the facts from primary sources and write the story in our own voice. Never reword another outlet's article sentence by sentence, and don't rely on a "Source:" line to fix that.
- **Link the primary source** in the story body (city, school district, agency, or the document itself).
- **Byline** must link to the specified author's account. If no other author is specified, use JD's account (`jd@orboro.net`): look up its `user.id`, set the article's `author_id` to that id, and use the account's display name (`JD`) as the saved byline. Never use `Firelands Current staff`. If the JD account cannot be found, resolve the attribution before importing a story.
- **Verify dates.** Confirm each fact's date on the source page itself. Search-engine summaries have mixed up years (a September 2025 dispensary opening and a fall 2025 terror-plot case both showed up as "this month"). Skip anything older than the current news cycle unless it explains something current.
- **Say what we don't know.** If an announcement gives a claim without figures or terms, report the claim and note what's missing, as the job-growth and visitors-bureau stories do.
- **Local first.** Publish to the local database, let the editor review in local dev, and sync to production only when asked (see "Getting a story live").
- **Photos** need permission and a credit. Don't take images from Facebook pages or other sites without asking the owner; add them through the media library.

## Coverage area

Sandusky and the communities around Sandusky Bay, from Port Clinton and Fremont east to Vermilion and Oberlin, and south to Norwalk.

| Tier | Places | What we cover |
| --- | --- | --- |
| Core | Sandusky, Perkins Township, Huron, Vermilion, Milan, Castalia, Berlin Heights, Bay View, Kelleys Island, and the rest of Erie County | Everything: government, schools, business, public safety, events |
| Regular | **Ottawa County:** Port Clinton, Oak Harbor, Marblehead, Lakeside, Danbury. **Sandusky County:** Fremont, Clyde, Bellevue, Green Springs. **Huron County:** Norwalk, Monroeville, Collins, Wakeman. **Western Lorain County:** Amherst, South Amherst, Oberlin, Kipton, Henrietta, Brownhelm | Significant news, county government, and events that draw people from across the area |
| Edge | Lorain, Elyria, Sheffield, Sheffield Lake, Avon, and the rest of eastern Lorain County; Flat Rock and northern Seneca County | Only stories that affect the Sandusky area (regional employers, roads, Lake Erie, county-wide or state decisions) |

Places outside these areas, including Toledo and Cleveland, are covered only when the story lands here.

## Sources

### Reliable and open

| Source | Good for | Notes |
| --- | --- | --- |
| [City of Sandusky](https://www.cityofsandusky.com/) | Commission meeting recaps, staff and appointment news | News pages are `news_detail_T12_R###.php`; recaps are `blog_T41_R##.php`. The `/news.php` URL 404s, so start from the home page. |
| [Sandusky City Schools](https://www.scs-k12.net/) | Levy, calendar, new programs, closures | The Levy Hub and Back to School Hub pages carry the details. |
| [Huron City Schools](https://huronk12.org/) | District operations, safety, newsletters and community conversations | Used Oct. 4, 2026. News posts link to PDF newsletters; check the newsletter date and read the relevant pages. Future events can remain current even when announced earlier. |
| [Port Clinton City Schools](https://www.pccsd.net/) | District news, school fundraisers and community events | Used for the Oct. 5, 2026 Kick for the Cure fundraiser involving Sandusky teams. News pages include a posting date; distinguish game admission from paid fundraiser activities. |
| Erie County ([eriecounty.oh.gov](https://www.eriecounty.oh.gov/)) and the [County Auditor](https://auditor.eriecounty.oh.gov/) | Commissioner actions, property tax, ballot levies | Auditor press releases are PDFs. Read them with `pdftotext -layout`. |
| [ODOT](https://www.transportation.ohio.gov/) and the [U.S. 6 project page](https://publicinput.com/usr6) | Road and roundabout projects | The ODOT project page itself may 404; PublicInput works. Completion dates differ between sources, so quote ODOT. |
| [ODNR](https://ohiodnr.gov/) | Hunting seasons, fishing, parks | The season chart is a PDF; use `pdftotext -layout`. Zone columns need careful reading. |
| [Bureau of Labor Statistics regional releases](https://www.bls.gov/regions/midwest/) | Wage and employment data | The Sandusky area means Erie and Ottawa counties. |
| [Greater Sandusky Partnership](https://greatersandusky.com/) | Business and economic announcements | `curl` gets a 403; the page reads fine through a web fetch. Announcements are short, so check them for missing figures. |
| [Ohio Lake Erie Commission](https://lakeerie.ohio.gov/) | Lake Erie restoration, grants | Some deep links move; search by title. |
| [Erie County Health Department](https://eriehealthohio.com/news-page/) | Public health grants, clinics, lead and housing programs, overdose response | Posts several dated items a week. Many put the details in an image of the press release, so open the image (or the page in a browser) before writing. Program pages and posts don't always agree on figures; report the difference. The old `eriecohealthohio.com` address redirects here. |
| [City of Huron](https://www.cityofhuron.org/) | Leaf pickup, hydrant flushing, city services and events | Same site platform as Sandusky; news pages are `news_detail_T3_R##.php`. |
| [Perkins Township](https://perkinstownship.com/) | Trustee actions, police and fire, township events | WordPress; RSS at `/feed/`. Used for the October 2026 Fire Station 3 open house and township events. Its [official Facebook Page](https://www.facebook.com/PerkinsTownship) also carries event flyers; verify their dates and use website announcements when available. Meeting minutes are PDFs under `/wp-content/uploads/`. |
| [Erie County Board of Elections](https://www.boe.ohio.gov/erie/) | Candidate and issue filings, voting dates | The filing PDFs block scripted downloads and sometimes return a maintenance page; try again later or ask the board for a copy. |
| [City of Sandusky on Facebook](https://www.facebook.com/cityofsandusky) and [Sandusky Police](https://www.facebook.com/sanduskypolice) | Commission meeting notices, events, groundbreakings, new officers | Official accounts, so usable as a source, but link the city website or document when one exists. Posts often carry details the city website never gets. |
| [Huron County](https://www.huroncounty-oh.gov/) | County departments | Thin on news; useful for facts and contact details. |
| [Erie MetroParks](https://eriemetroparks.org/), [program brochures](https://eriemetroparks.org/brochures/) and [official Facebook Page](https://www.facebook.com/erieparks) | Park programs, trail activities and conservation | Monthly PDF brochures supply dates, hours, ages, registration and meeting places. Read the year printed inside each brochure. Seasonal activity pages can retain older introductory wording; compare the detailed instructions and dated clue files. The official website links to the Facebook handle `erieparks`. |
| [City of Norwalk calendar](https://www.norwalkoh.com/city-calendar) | Service changes, council meetings and community events | Squarespace event URLs can contain an old year while the displayed event header identifies the current occurrence. Verify that header, narrative and venue. Calendar blocks do not always establish a parade's duration. The city homepage has no useful news feed; go directly to this calendar. `cityofnorwalk.org` is a parked domain, not the city. |
| [The Chef's Garden](https://chefs-garden.com/) and [market events](https://chefs-garden.com/market-events/) | Huron farm market events and agriculture | Organizer pages identify the year, hours and activities. The former Farmer Jones Farm address redirects here. Check admission and activity charges separately; a vendor festival announcement does not establish free entry. Greater Sandusky Partnership can corroborate the Farm Market venue. |
| [City of Oberlin](https://cityofoberlin.com/) | Council vacancies, boards, grants | Used for the Oct. 16, 2026 council application deadline. Notices can link to application PDFs. Keep appointment deadlines separate from the date the seat becomes vacant. |
| [OHgo](https://www.ohgoreach.org/) | Food assistance, fresh markets, school pantries and fundraisers | Added Oct. 4, 2026. Its [official Facebook Page](https://www.facebook.com/ohgoreach) carries current distributions; event schedules also link to Raise. The Empty Bowls homepage promotion still said tickets were live when the linked ticket page said sold out; use the event page for availability. |
| [Huron County Growth Partnership](https://huroncountyohio.com/) | County economic development, business awards, land-use planning and public surveys | Used Oct. 5, 2026. The [awards announcement](https://huroncountyohio.com/2026annualawards/) and [land-use survey announcement](https://huroncountyohio.com/landusesurvey/) carry dated details; its [event calendar](https://members.huroncountyohio.com/member-events-calendar) verifies venue, access and registration. An older forum article calls Oct. 7, 2026 Thursday; the actual awards listing correctly says Wednesday. Attribute expansion and job projections; do not imply hiring is complete. |
| [Extol of Ohio](https://extolohio.com/category/whats-new/) | Company announcements and Norwalk manufacturing expansion details | Used Oct. 5, 2026 to corroborate the company's business award and use of its expanded facility. Company claims need attribution; an award announcement does not establish how many projected jobs have been filled. |
| [Rutherford B. Hayes Presidential Library & Museums](https://www.rbhayes.org/) | Fremont exhibits, history programs and community events | Used Oct. 6, 2026 for the Warrior Dogs exhibit and October History Roundtable sessions. Read detailed event descriptions and [visitor information](https://www.rbhayes.org/visit-us/visitor-information/) for actual hours and admission; calendar entries can show midnight placeholders. The detailed exhibit listing says Oct. 2–31 while the broader America 250 page says Oct. 1–31. Virtual Roundtable sessions are prerecorded and require advance registration/payment. |
| [Sandusky County Fairgrounds](https://www.sanduskycountyfair.com/) | Fremont flea markets and fairgrounds events | Used Oct. 6, 2026. The [flea market schedule](https://www.sanduskycountyfair.com/flea-markets) explicitly identifies the year, dates, daily hours and free admission/parking. Saturday and Sunday hours differ. |
| [Catholic Parishes of Sandusky](https://sanduskycatholic.org/) | Parish closures, service changes and community programs | Used Oct. 7, 2026 for the Saints Peter and Paul roof-related closure. Homepage notices can include explicit service dates without a posting date. A hoped-for repair date is not a confirmed reopening. Check parish bulletins and updates. |
| [Erie County Sheriff's Office civilian fingerprinting](https://www.eriecounty.oh.gov/CivilianFingerprinting.aspx) | Background-check fees, appointments and payment requirements | Used Oct. 7, 2026. The dated Oct. 1 fee notice lists $39 for FBI and $73 for combined BCI/FBI checks, but an older paragraph still lists $36/$70. Disclose the discrepancy and tell applicants to confirm payment with the office. |
| [Huron Public Library](https://www.huronlibrary.org/) and [LibCal](https://huronlibrary.libcal.com/calendar/programs) | Library programs, book sales and family events | Used Oct. 7, 2026. Read each daily event listing for hours, membership restrictions, scanner rules and registration. The homepage's Oct. 7 book-sale item linked to Thursday's listing. Search can return Huron, South Dakota's library; use this Ohio library's own calendar. |
| [Oak Harbor Area Chamber of Commerce](https://www.oakharborohio.net/) and [Apple Festival](https://www.oakharborapplefestival.com/) | Oak Harbor business and community events | Used Oct. 8, 2026 for the Oct. 10–11 Apple Festival. The chamber verifies the year; the dated schedule image and individual activity pages supply locations and times. Opening ceremonies differ between the general homepage (9:30 a.m.) and 2026 schedule (9 a.m.); omitted that time. Free festival admission does not mean all activities are free. |
| [City of Port Clinton](https://www.portclinton.com/) and [official Facebook Page](https://www.facebook.com/PortClintonOH) | Water and sewer projects, city services, staff and transit | Used Oct. 8, 2026 for the Oct. 10 cleanup. Website news pages are `news_detail_T28_R##.php`; Facebook has newer service flyers. Read the full flyer for restrictions and location. The cleanup notice names a City Hall lot with a Police Station entrance off Buckeye Boulevard; do not infer a street number from the site's footer, which coexists with a 2025 relocation notice. |
| [Sandusky County Soil and Water Conservation District](https://www.sanduskycoswcd.org/events/) | Conservation, agriculture, water quality and library education programs | Used Oct. 8, 2026 for Clyde and Fremont fungi programs. Individual event pages explicitly identify 2026, venue and hours; use a browser if web fetch times out. The education page says library programs are free. Sparse event descriptions do not establish age limits, registration rules or foraging activities. |

### Sources added Oct. 9, 2026

- [Sandusky County Visitors Bureau](https://www.sanduskycounty.org/) supplies Fremont-area events and its own [historic jail and dungeon tour schedule](https://www.sanduskycounty.org/jail). Used for Oct. 14 and 28, 2026 calendar entries. The dated tables and ticket dropdowns confirm prices and start times; a stale 2025 heading remains elsewhere. Flashlight tour duration differs between the table (90 minutes) and narrative (about 75 minutes). Walk-ins are not accepted. The separate Oct. 23 Dungeon Descent is marked sold out; don't infer availability from a ticket dropdown.
- Sandusky's [Pipe Creek project page](https://www.cityofsandusky.com/city_projects/pipe_creek_parking_lot.php) gives the October 2026 construction schedule, contract cost and scope. Its official Oct. 8 Facebook notice explicitly says the parking lot is closed. Distinguish scheduled completion from confirmed reopening; the city maintains the entrance while ODNR manages wetland cells.
- The city's [Halloween contest entry form](https://www.cityofsandusky.com/HauntedHouse) redirects to Survey123. Used with the official Oct. 8 Facebook announcement to verify the Oct. 16 deadline, city-limit eligibility and required photo permission. Read the city's own comment for the entry link; residents' comments are leads only.

### Sources added Oct. 10, 2026

- [U.S. Army Corps of Engineers, Buffalo District](https://www.lrd.usace.army.mil/buffalo) supplies Sandusky Harbor navigation, dredging and Lake Erie engineering announcements. Releases also appear on [Army.mil](https://www.army.mil/). Check the release date, scheduled work dates and contractor; older photo albums can retain outdated contract descriptions. The district's [Flickr account](https://www.flickr.com/photos/buffalousace/) has file photos, but verify the license on each image rather than assuming every government account image is public domain. CC BY-ND photos should remain uncropped body figures instead of cropped lead/card images.
- [Lakeside Chautauqua](https://lakesideohio.com/) and the [Marblehead Peninsula Chamber of Commerce](https://themarbleheadpeninsula.com/) supply peninsula festivals and community programs. Use the year-specific organizer event page and [event changes](https://lakesideohio.com/calendar/event-changes/). Narrative hours can be more precise than an all-day calendar label. Free gate admission does not establish that every activity is free; check wristbands, tours and parking separately.
- The City of Sandusky's official Facebook Page links to detailed event announcements. Expand the full description and verify the year in the event header; a generic map pin does not establish every activity's venue. Separate citywide trick-or-treat hours from the downtown program, and wait for the organizer's participating-location map before describing a route.

### Sources added Oct. 12, 2026

- [Firelands Health](https://www.firelands.com/) supplies dated hospital programs in Sandusky and Bellevue through its [classes and events calendar](https://www.firelands.com/classes-events/). Detail pages verify the year, venue, registration and charges. The Oct. 17 breast-screening announcement limits eligibility and distinguishes insurance billing from a patient's remaining balance; do not describe it as an unrestricted walk-in mammogram event. Blood-drive pages can say registration is not required while also offering appointment scheduling.
- [Erie County Community Foundation](https://eriefoundation.org/), its [media releases](https://eriefoundation.org/media-usage/) and [X account](https://x.com/ErieCCF) supply nonprofit grants, scholarships and workshops. Its Oct. 6, 2026 post led to the [Oct. 21 nonprofit AI workshop registration page](https://eccflccc26october.rsvpify.com/), which confirms the year and 11:30 a.m. start. Verify venue addresses separately and leave unannounced end times blank. The media page permits use of supplied logos subject to its conditions; it does not grant blanket permission for photographs or flyers.
- Huron County Growth Partnership's [Oct. 9 annual-event report](https://huroncountyohio.com/huroncountyawards2026/) introduces a $12 million natural-gas improvement project with Norwalk and partners. The report does not specify the utility, construction location, funding breakdown, completion schedule or date of the promised October groundbreaking. Its business-attraction leads are prospects, not confirmed investments or jobs.

### X sources

Followed from Firelands Current on Oct. 9, 2026: [City of Sandusky](https://x.com/cityofsandusky), [Sandusky Transit](https://x.com/SanduskyTransit), [Sandusky Schools](https://x.com/gobluestreaks) and [Perkins Schools](https://x.com/perkinspirates). The city and transit accounts carry government and service leads. Sandusky Schools' newest visible post was July 2023; use its website for current news. Perkins' visible feed includes August 2026 notices. Check each post's full date before relying on it, and corroborate on the agency's website when available. The existing follow of @_SanduskyOhio describes local updates but does not establish official city ownership.

### Promising, not yet used

Additional lead checked Oct. 7, 2026: [Ohio Council of Teachers of Mathematics](https://ohioctm.org/Annual-Conference-Sandusky-2026) for educator conferences and programs at Kalahari. Its Oct. 8–9, 2026 conference page says registration is closed; verify access and local participation before coverage.

- [Ohio Library Council](https://www.olc.org/) supplies library policy, professional programs and conferences. Its [2026 convention page](https://www.olc.org/2026-convention-and-expo/) identifies local library organizers and an Oct. 21–23 gathering at Kalahari. Main and keynote pages disagree on whether registration is open; verify attendance or media access before listing it as a public event.
- [The Wave at Marblehead](https://www.wavemarblehead.com/happenings) supplies venue programs and meal events. Check the year, cost and reservation/access terms on each listing before adding it to the calendar.
- [Maritime Museum of Sandusky](https://sanduskymaritime.org/) is a potential source for museum programs and local maritime history. Verify current dates and visitor access on detailed organizer listings before using it.
- [Ottawa National Wildlife Refuge](https://www.fws.gov/refuge/ottawa) is a potential source for birding, conservation and refuge programs. Use dated U.S. Fish and Wildlife Service event details; an ongoing homepage promotion does not establish a particular program's next occurrence.

Found in an October 2026 probe of the wider coverage area. None of these has produced a story yet, so check a source's dates and figures carefully the first time you use it, then move it to the table above.

**Posting regularly**

| Source | Good for | Notes |
| --- | --- | --- |
| [City of Oak Harbor](https://www.oakharbor.oh.us/newslist.php) | Street and school-zone safety projects, grants | Revize. A few posts a year. |
| [Village of Clyde](https://www.clydeohio.org/CivicAlerts.aspx) | Village notices and events | CivicPlus. Posts every few weeks. |
| [City of Amherst](https://amherstohio.org/) | Road projects, joint work with Lorain | WordPress; RSS at `/feed/`, irregular. |
| [Vermilion Local Schools](https://www.vermilionschools.org/) | District news and calendar | Some dates on the home page are upcoming events, not posts. |
| [BGSU Firelands](https://www.bgsu.edu/firelands/news.html) | Campus programs, enrollment, community events | About one post a month. |
| [Ohio Sea Grant and Stone Lab](https://ohioseagrant.osu.edu/news) | Lake Erie research, algal blooms, water quality | Several posts a week, statewide; use the ones about the western basin or Sandusky Bay. |
| [Huron County Public Health](https://www.huroncohealth.com/public-information) | Public health notices for Norwalk and Huron County | Dated items; check how current the latest one is. |
| [Huron County](https://www.huroncounty-oh.gov/) RSS | County departments | The home page lists several RSS feeds (Revize `rss?token=…` links), which may be easier to watch than the site. |

**Nonprofits and community funding**

Added Oct. 3, 2026. These sources have not yet produced a story; check announcement dates and distinguish application deadlines from award dates.

| Source | Good for | Notes |
| --- | --- | --- |
| [Sandusky County Communities Foundation](https://www.sanduskyccf.org/) | Local grants, scholarships and funded community projects | Wix. Start with [News and Events](https://www.sanduskyccf.org/news-and-events) and [Grant Guidance and Timeline](https://www.sanduskyccf.org/grant-guidance). The 2026 timeline lists a Celebration of Philanthropy for Oct. 14 at 5 p.m.; confirm venue, access and recipients before coverage. Older grant PDFs can appear in search results. |
| [United Way of Sandusky County](https://uwsandco.org/) | Community services, nonprofit funding, food assistance and volunteer opportunities | Use its program pages, assistance directories and [grant funding page](https://uwsandco.org/grant.php). The homepage still featured August events when checked in October 2026, so do not assume featured announcements are current. |
| [Care & Share of Erie County](https://careandshareerieco.org/hours/) | Food and clothing assistance in Sandusky | Added Oct. 4, 2026. Direct service-hours and eligibility page; verify requirements and exceptions before writing a service guide. |
| [Sandusky County Job and Family Services](https://sanduskycountydjfs.org/public/food-assistance/) | County food assistance, pantry and meal referrals | Added Oct. 4, 2026. Lists providers and service areas; confirm individual schedules with each provider. |

**Slow, stale, or hard to read**

| Source | Good for | Notes |
| --- | --- | --- |
| [City of Fremont](https://fremontohio.org/residents/news-updates/) | Council meeting notices, city services | WordPress; RSS at `/feed/`, but only a few posts a year. |
| [Ottawa County](https://www.co.ottawa.oh.us/) | Commissioners, county departments | CivicPlus. The News Flash page and RSS feed are nearly empty; use the site for agendas and contacts. |
| [Ottawa County Health Department](https://www.ottawahealth.org/) | Public health | CivicPlus. The news page didn't show current items. |
| [Sandusky County](https://sanduskycountyoh.gov/) | County government, public notices | No news section; check the Public Notices menu. `sandusky-county.org` redirects here. |
| [Sandusky County Public Health](https://www.scpublichealth.com/news) | Public health, disease reports | The news list loads by script; open it in a browser. |
| [City of Bellevue](https://www.bellevueohio.gov/news/index.php) | City news | Revize; the news list loads by script. |
| [Village of Milan](https://milanohio.gov/) | Village notices | No news page; undated announcements on the home page. |
| [City of Vermilion](https://www.cityofvermilionohio.gov/) | City news | Returns 403 to scripted requests; open it in a browser. `vermilion.net` redirects here. |
| Perkins Schools, Margaretta Schools, Fremont City Schools, [EHOVE Career Center](https://www.ehove.net/) | District news | Home pages load their news by script; check them in a browser. |
| [Ottawa County Sheriff](https://ottawacountysheriff.info/press-releases-2/) | Press releases | WordPress with RSS, but the newest release found was from September 2024. |
| Erie County and Huron County sheriffs | Contacts | Neither site has press releases. |
| [Sandusky Library](https://www.sanduskylib.org/) | Library programs and events | WordPress; RSS at `/feed/`. |
| [Lake Erie Shores & Islands](https://www.shoresandislands.com/) | Tourism events and visitor numbers | Returns 403 to scripted requests. It's the tourism bureau, so check its figures. |

**Facebook Pages**

Many villages, townships, police and fire departments, and schools here post on Facebook first, or only there. These official Pages turned up in a Facebook Pages search in October 2026; posting frequency wasn't checked. As with the City of Sandusky's Page, link the agency's website or document when one exists. Facebook search needs a signed-in browser.

| Area | Pages |
| --- | --- |
| Cities and villages | [Huron](https://www.facebook.com/cityofhuronohio), [Vermilion](https://www.facebook.com/cityofvermilion), [Milan](https://www.facebook.com/milanohio), [Norwalk](https://www.facebook.com/norwalkoh), [Port Clinton](https://www.facebook.com/PortClintonOH), [Oak Harbor](https://www.facebook.com/oakharborohio), [Fremont](https://www.facebook.com/fremontoh), [Clyde](https://www.facebook.com/clydeohio) |
| Townships | [Perkins Township](https://www.facebook.com/PerkinsTownship), [Margaretta Township](https://www.facebook.com/Margaretta.Township) |
| Police | [Perkins](https://www.facebook.com/perkinspd), [Bay View](https://www.facebook.com/bayviewpolice), [Milan](https://www.facebook.com/MilanPoliceDept), [Vermilion](https://www.facebook.com/VermilionPolice), [Norwalk](https://www.facebook.com/NorwalkPD), [Bellevue](https://www.facebook.com/BellevueOhioPoliceDepartment), [Fremont](https://www.facebook.com/FremontOhioPD), [Catawba Island](https://www.facebook.com/CatawbaIslandPD), [Put-in-Bay](https://www.facebook.com/pibpolice), [Oak Harbor](https://www.facebook.com/profile.php?id=100076260115088), [Kelleys Island](https://www.facebook.com/profile.php?id=100083855786981) |
| Sheriffs | [Huron County](https://www.facebook.com/profile.php?id=100064950511302) (32K followers). No main Page turned up for the Erie County or Ottawa County sheriffs; Ottawa County has only division Pages (K9, Reserve, Dog Warden). |
| Fire and EMS | [Sandusky Fire](https://www.facebook.com/SanduskyFire), [Perkins Fire](https://www.facebook.com/PerkinsFire), [Huron Fire](https://www.facebook.com/HuronFirefighters), [Bellevue Fire](https://www.facebook.com/profile.php?id=100064420282942), [Sandusky County EMS](https://www.facebook.com/SanduskyCoEMS), [Huron County EMA](https://www.facebook.com/huroncountyema) |
| County government | [Erie County Board of Elections](https://www.facebook.com/profile.php?id=61555788237831), [Erie County DOES](https://www.facebook.com/profile.php?id=100064497117321), [Ottawa County Common Pleas Court](https://www.facebook.com/ococpc), [Sandusky County Commissioners](https://www.facebook.com/profile.php?id=61593423602465), [Sandusky County Board of Elections](https://www.facebook.com/profile.php?id=100069026985826), [Sandusky County Park District](https://www.facebook.com/SanduskyCountyParkDistrict) |
| Health | [Erie County Health Department](https://www.facebook.com/eriecohealth), [Ottawa County Health Department](https://www.facebook.com/profile.php?id=100068590342843), [Sandusky County Public Health](https://www.facebook.com/sanduskycopublichealth) |
| Schools | [Perkins](https://www.facebook.com/PerkinsLSD) (a second Page, [Perkins Local Schools](https://www.facebook.com/PerkinsLocalSchools), also exists; confirm which the district uses), [Margaretta](https://www.facebook.com/margarettaschools), [Huron](https://www.facebook.com/HuronCitySchools), [Edison](https://www.facebook.com/EdisonLocalSchools), [Vermilion](https://www.facebook.com/VermilionSchools), [Norwalk](https://www.facebook.com/norwalkcitysd), [Port Clinton](https://www.facebook.com/portclintonschools), [Bellevue](https://www.facebook.com/BCSRedmen), [Oberlin](https://www.facebook.com/OberlinCitySchools) |
| Business and tourism | [Visit Huron Ohio](https://www.facebook.com/visithuronohio), [Vermilion Chamber](https://www.facebook.com/vermilionchamber), [Port Clinton Area Chamber](https://www.facebook.com/PCChamber), [Bellevue Chamber](https://www.facebook.com/bellevueohiochamber), [Fremont Economic Development](https://www.facebook.com/FremontOhioED) |
| Libraries | [Clyde](https://www.facebook.com/clydelibrary), [Monroeville](https://www.facebook.com/MonroevillePLOhio), [Green Springs](https://www.facebook.com/GreenSpringsLibrary) |

Not found: a Page for the City of Bellevue itself, ODOT District 3, or Fremont City Schools. Facebook's search ranks by distance and name, so try other wordings before deciding a Page doesn't exist.

### Handle with care

| Source | Why |
| --- | --- |
| Sandusky Register, Norwalk Reflector | Paywalled or script-rendered. Headlines and subheads are public and fine as leads. Don't get around the paywall and don't reuse their reporting. |
| Norwalk Ohio News | Requires a login. |
| Facebook event search | Good for finding community events. Confirm the date, time and place on the organizer's own page before listing, since anyone can create an event. |
| Facebook groups (The Real Talk of Sandusky) | Mostly anonymous chatter and sales posts. Use only as leads, confirm with an official source, and never quote private individuals. |
| Reddit (r/Sandusky) | Shows what residents are asking about, not news. |
| Web search summaries | Often wrong on dates and details. Open the linked page before using a fact. |

## Finding stories

1. Check the primary sources above for anything dated in the last few weeks.
2. Compare against what we've published (`/news`, or `SELECT slug, headline FROM news_articles`) so we don't repeat a story.
3. Aim for at least three current stories per section so every homepage block fills in. Government, Business, Schools, Outdoors and Community have three or more; Local News is thin, so check public safety, transit, utilities and county services.
4. A tool like `/last30days` can surface Reddit and web chatter, but its results are leads, not sources.

## Getting a story live

Stories are rows in `news_articles`, and a published story also gets a discussion thread in `forum_threads` (the admin editor does this through `ensureArticleThread`).

1. Write the story as Markdown and check the headline, summary and body against the source.
2. Insert it into the local database (for example with `npx wrangler d1 execute DB --local --file stories.sql`), setting the article's `author_id` and byline as described above and including a matching discussion thread with `author_id = 'newsroom'`. The discussion's Newsroom author is separate from the article's account-linked byline. Only `/media/…` library images render in the body.
3. Review at `http://127.0.0.1:4321/news`.
4. When the editor says to sync, insert the same rows into production (`--remote`), then confirm counts per section on both sides. Migrations, if any, are applied first (see AGENTS.md).

Inserting stories changes only data, so it needs no version bump. Code changes (layout, new features) ship as releases as described in AGENTS.md.
