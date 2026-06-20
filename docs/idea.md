I want to build a single page web app (SPA) that is a single place of information for the PRO3 racing league. I would like to build a pretty app that allows both drivers, fans, and visitors to get a quick overview of the season and where to watch the next race.

We have a lot of visuals to choose from that we can source from the existing sites or from instagram. The current social media manager is generating posters to advertise the next race that we could display https://www.instagram.com/pro3racing/p/DZxUwBEMCiM/

There are a few features I think we should consider

- season leaderboards
- season schedule
- links to
  - official website
  - social media embed (instagram)
  - merch store
- mission statement
- contact info

nice to have (not now)

- prize winners
- "Where to start" providing information to speculative drivers
- car listings
  - requires perhaps auth or login, seller pages, legal disclaimers, etc.

The leaderboard is tracked via this legacy php website that we might need to scrape either at page load or periodically.

https://www.icscc.com/points/2026/icsccClassPoints.json?_=1781967774669

I'm not sure what the suffix is, perhaps a epoch timestamp? I can dig in further if needed, the base page is at https://www.icscc.com/points.php?season=2026

Here are the other URLs we'll be managing

- https://www.pro3-racing.com/
  - the official page, it has a lot of lore but doesn't track the season
- https://www.instagram.com/pro3racing
- https://www.icscc.com/season.php
  - the php page with the current season's schedule
- https://rogerscg.github.io/pro3-history-release/
  - greg put together a stats page, but it's more about the history rather than the current season

Let's start by making a plan to determine if this needs to be a JS only SPA or if we'll need a server to do some of the cross site queries. Then lets brainstorm how we'll source the information and embed it. Then let's consider designs and layouts.
