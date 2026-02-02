## Letterboxd Stats Visualizer

An unofficial Letterboxd stats dashboard that lets you explore your movie‑watching habits with rich visualizations. Enter a Letterboxd username and the app will fetch that user’s public data, enrich it with TMDB, and render interactive charts for years, ratings, genres, countries, languages, directors, actors, and more.

> This is a personal project and is **not** affiliated with Letterboxd.

---

### Features

- **Username‑based lookup** – Type any public Letterboxd username and fetch their stats.
- **Year & diary breakdown** – See how many unique films you’ve seen per year, your average rating per year, and how many entries come from the diary (watch‑date based) vs total films.
- **Rating distribution** – Histogram of your star ratings.
- **Genres / countries / languages** – Top genres, countries, and languages, toggleable between “most watched” and “highest rated”.
- **Directors & actors** – Most‑watched directors and cast members.
- **Decade view** – Best decades by average rating, including highlight posters.
- **Time spent** – Total runtime in hours across all enriched films.

---

### How It Works

The data pipeline is implemented in `api/fetch-user-data.js` (ESM) and `letterboxd-backend/fetch-user-data.js` (CommonJS) for serverless / Node environments:

1. **Fetch films first (primary source)**
	- Scrapes the user’s public `/films/` grid pages on Letterboxd.
	- Builds a canonical list of films: title, year (when available), rating (including rated‑but‑not‑logged films), and the Letterboxd film URL.

2. **Fetch diary separately (for by‑year diary stats)**
	- Scrapes the user’s `/diary/` pages.
	- Extracts watch dates, titles, years and ratings where present.
	- Diary is used mainly to track **watch dates per year** and to fill gaps when the films grid is missing data.

3. **Merge films + diary**
	- Films grid entries are treated as the **primary** record for each movie.
	- Diary entries are overlaid to:
	  - Attach `Date` (watch date) for diary‑based “by year” charts.
	  - Optionally fill missing `Rating` / `Year` if the film entry doesn’t have them.

4. **Enrich with TMDB**
	- For each merged film, the backend calls TMDB’s search and movie detail APIs.
	- It fetches:
	  - Posters & backdrops
	  - Genres
	  - Production countries
	  - Original language
	  - Runtime
	  - Directors & cast (via `credits`)
	- The frontend then uses this enriched data to power all the charts and stats.

The frontend logic for visualization lives primarily in `App.tsx` and uses **Recharts** for charts and **lucide-react** for icons.

---

### Prerequisites

- Node.js (LTS recommended)
- A TMDB API key (free to create at https://www.themoviedb.org/)

---

### Setup & Local Development

1. **Install dependencies**

	```bash
	npm install
	```

2. **Configure environment variables**

	The backend scraper / enricher requires a TMDB key:

	- `TMDB_API_KEY` – used by `api/fetch-user-data.js` / `letterboxd-backend/fetch-user-data.js`.


	Optional: Upstash Redis (caching)

	This project can optionally cache enriched responses in an Upstash Redis (recommended to reduce scraping and TMDB load). If you enable a DB, set these environment variables in your deployment (Vercel, Netlify, etc.):

	- `UPSTASH_REDIS_REST_URL` – the Upstash REST URL for the database (https://<prefix>.upstash.io)
	- `UPSTASH_REDIS_REST_TOKEN` – the Upstash REST **token** (use the write token if you want caching writes to succeed)

	Alternative/integration names the code accepts (set any of these if you use the Vercel Upstash integration):

	- `KV_REST_API_URL`, `KV_REST_API_TOKEN`, `KV_URL`, `REDIS_URL`, `KV_REST_API_READ_ONLY_TOKEN`

	Compatibility note: if you added temporary names like `NEW_STORAGE_KV_REST_API_URL` / `NEW_STORAGE_KV_REST_API_TOKEN`, the backend also recognizes those as fallbacks.

	When running the frontend locally, you can point it at a deployed backend (e.g. a Vercel function) using:

	- `VITE_API_BASE_URL` – optional; base URL of the backend (e.g. `https://your-app.vercel.app`). If omitted, the app will call `/api/fetch-user-data` on the same origin.

3. **Run the dev server**

	```bash
	npm run dev
	```

	This starts the Vite dev server. By default it expects an `/api/fetch-user-data` endpoint to be available (locally via a proxy or on a remote host via `VITE_API_BASE_URL`).

4. **Build for production**

	```bash
	npm run build
	```

	The static assets are emitted into the `docs/` directory for easy GitHub Pages hosting.

5. **Preview the production build**

	```bash
	npm run preview
	```

---

### Deploying

There are many ways to deploy this project; one simple pattern is:

- **Frontend (this repo)**
  - Build with `npm run build`.
  - Serve the `docs/` folder via GitHub Pages, Netlify, or any static host.

- **Backend (Letterboxd + TMDB integration)**
  - Deploy `api/fetch-user-data.js` or `letterboxd-backend/fetch-user-data.js` as a serverless function (e.g. Vercel, Netlify Functions, or a small Node/Express app).
  - Set the `TMDB_API_KEY` environment variable in your backend deployment.
  - Configure `VITE_API_BASE_URL` in the frontend environment so the app knows where to reach the backend.

- When deploying to Vercel and using Upstash, you may instead configure the Upstash integration which creates `KV_*` env vars automatically. If you prefer manual control, add `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` to your Project → Settings → Environment Variables and redeploy.

### Troubleshooting

- `WRONGPASS invalid or missing auth token` from Upstash: your `UPSTASH_REDIS_REST_TOKEN` is incorrect. Copy the REST Token from the Upstash Console (REST API section) and paste it into Vercel without quotes or extra whitespace, then redeploy.
- `getaddrinfo ENOTFOUND <something>.upstash.io`: indicates the configured Upstash hostname no longer resolves (archived or deleted DB). Ensure `UPSTASH_REDIS_REST_URL` points to your active DB.
- `403 Forbidden` from Letterboxd: scraping can be blocked by IP or anti-bot rules. The backend adds realistic headers and retries, but you may need to run the function from a different IP, use a proxy service, or implement a headless-browser fallback (Puppeteer) if blocking persists.

---

### Notes & Limitations

- Scraping is subject to Letterboxd’s HTML structure; if they change their markup, scraping code may need updates.
- TMDB search isn’t always perfect; some films may be mis‑matched or not found.

---

### License

This project is shared for personal / educational use. Update this section if you choose a specific license.

