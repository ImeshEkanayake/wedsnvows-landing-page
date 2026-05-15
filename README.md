# Weds & Vows Coming Soon

Landing page for `wedsnvows.com`, with a suggestions form that stores submissions in PostgreSQL on Railway or a local CSV fallback.

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Deploy on Railway

1. Push this repository to GitHub.
2. Create a new Railway project from the GitHub repo.
3. Add a PostgreSQL service in Railway if you want database storage.
4. Set these variables in Railway:

```bash
ADMIN_TOKEN=use-a-long-random-secret
DATABASE_URL=automatically-added-by-railway-postgres
```

Railway will run `npm start`.

## Get the suggestions as CSV

After deploy, open:

```text
https://your-railway-domain/admin/submissions.csv?token=YOUR_ADMIN_TOKEN
```

If `DATABASE_URL` is set, the CSV is generated from PostgreSQL. If not, submissions are appended to `data/submissions.csv`.
