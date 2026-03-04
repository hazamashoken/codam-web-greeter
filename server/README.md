# Back-end server for codam-web-greeter
The back-end server provides data for the greeter to display, such as events and exams on [42's Intranet](https://intra.42.fr/). It also provides an endpoint to fetch an Intra user's profile picture.

> ⚠️ You should make sure this server is only accessible on your local campus network, to avoid leaking personal data to the outside world. It is also recommended to configure your campus's access-control lists in a way that allows only campus computers to access this server. If you do not know how to do this, ask your campus's network administrator for help.


## Running the server
### In production
1. Install docker
2. Set up SSL certificates in `./configs/certs` (`codam-web-greeter-server.crt` and `codam-web-greeter-server.key`)
3. Set up `.env` file (see `.env.example`)
4. Create a `messages.json` file with at least the following JSON content:
```json
{}
```
5. Run `docker compose up -d` in the root of this repository
6. The server should now be running on port 443 (and 80, which redirects to 443)


### In development
1. Install node.js & npm (the code was written with v18.17.1 in mind but might also work in later versions)
2. Set up `.env` file (see `.env.example`)
3. Create a `messages.json` file with at least the following JSON content:
```json
{}
```
4. Run `npm ci` in this directory
5. Run `npm run build` in this directory
6. Run `npm run start` in this directory
7. The server should now be running on port 3000

### Optional environment variables
These can be set in `.env` in addition to the required Intra variables:

- `TRUST_PROXY` (default: `loopback, linklocal, uniquelocal`): Express `trust proxy` setting.
- `RATE_LIMIT_WINDOW_MS` (default: `60000`): rate-limit window for protected endpoints.
- `RATE_LIMIT_CONFIG_MAX` (default: `60`): max requests per window for `/api/config/:hostname?`.
- `RATE_LIMIT_USER_IMAGE_MAX` (default: `30`): max requests per window for `/api/user/:login/.face`.
- `READINESS_MAX_CACHE_AGE_SECONDS` (default: `3600`): readiness threshold for cached data age.
- `INTRA_INIT_RETRY_DELAY_MS` (default: `60000`): retry interval for Intra API initialization.
- `INTRA_REFRESH_INTERVAL_SECONDS` (default: `300`): target refresh cadence for Intra events/exams.
- `INTRA_MAX_STALE_DATA_SECONDS` (default: `86400`): max age for serving stale cached events/exams when upstream fails.
- `INTRA_FETCH_RETRY_COUNT` (default: `3`): retry attempts for Intra API fetches.
- `INTRA_FETCH_RETRY_DELAY_MS` (default: `1000`): base delay between Intra fetch retries.
- `INTRA_FETCH_RETRY_BACKOFF_FACTOR` (default: `2`): exponential retry backoff factor.
- `API_KEY` (optional): if set, all `/api/*` routes require `X-API-Key` or `Authorization: Bearer <key>`.


## API
### `/health/live`
Returns liveness status and uptime. This endpoint does not depend on Intra cache readiness.

### `/health/ready`
Returns readiness status for the API process:
- Intra API client initialized.
- Cached `events` and `exams` present.
- Cache age is below `READINESS_MAX_CACHE_AGE_SECONDS`.

### `/metrics`
Returns in-memory metrics for:
- endpoint latency/error counts
- cache hit/miss/refresh/stale-serve counters
- upstream failure/success tracking

### `/api/config/:hostname?`
Request data to be displayed by the greeter for the given hostname. If no hostname is given, the IP address from the request is parsed and used instead (if possible).

> The exams key lists all future exams at the campus. The exams_for_host key lists only the exams the requested host is affected by (based on hostname/IP). When an exams_for_host key is present, the greeter will go into exam mode during the exam period.

#### Example return value
```json
{
	"hostname": "f0r4s5.codam.nl",
	"events": [
		{
			"id": 19721,
			"name": "BOCAL STAND-UP",
			"description": "Find out what is going on at Codam and what is coming up next week.",
			"location": "Auditorium",
			"kind": "event",
			"max_people": null,
			"nbr_subscribers": 0,
			"begin_at": "2023-11-20T15:00:00.000Z",
			"end_at": "2023-11-20T16:00:00.000Z",
			"campus_ids": [
				14
			],
			"cursus_ids": [
				21
			],
			"created_at": "2023-10-31T09:41:22.425Z",
			"updated_at": "2023-10-31T09:41:22.436Z"
		},
		...
	],
	"exams": [
		{
			"cursus": [
				{
					"id": 21,
					"name": "42cursus",
					"slug": "42cursus"
				}
			],
			"projects": [
				{
					"id": 1320,
					"name": "Exam Rank 02",
					"slug": "exam-rank-02"
				},
				{
					"id": 1321,
					"name": "Exam Rank 03",
					"slug": "exam-rank-03"
				},
				{
					"id": 1322,
					"name": "Exam Rank 04",
					"slug": "exam-rank-04"
				},
				{
					"id": 1323,
					"name": "Exam Rank 05",
					"slug": "exam-rank-05"
				},
				{
					"id": 1324,
					"name": "Exam Rank 06",
					"slug": "exam-rank-06"
				}
			],
			"id": 15191,
			"ip_range": [
				"10.10.4.0/24",
				"10.10.5.0/24",
				"10.10.6.0/24"
			],
			"begin_at": "2023-11-24T12:00:00.000Z",
			"end_at": "2023-11-24T15:00:00.000Z",
			"location": "f0",
			"max_people": 60,
			"nbr_subscribers": 11,
			"name": "Codam Exam",
			"created_at": "2023-10-24T13:02:56.047Z",
			"updated_at": "2023-11-15T14:56:06.920Z"
		},
		...
	],
	"exams_for_host": [
		{
			"id": 15191,
			"name": "Codam Exam",
			"begin_at": "2023-11-24T12:00:00.000Z",
			"end_at": "2023-11-24T15:00:00.000Z"
		},
		...
	],
	"fetch_time": "2023-11-15T15:39:52.062Z",
	"message": "A custom message to display on the login screen\nIt supports *bold* and _italic_ text",
}
```

### `/api/user/:login/.face`
Redirects to the user's profile picture served by Intranet's CDN. This endpoint can be used by the greeter to display the user's profile picture on the lock screen.

#### Example return data
A redirect to a raw image through a 300 status code, or a 404 error.

### `/api/exam_mode_hosts`
Returns a list of hostnames that are currently in exam mode. A host can only be displayed if it was able to fetch its configuration from the `/api/config/:hostname` endpoint at least once since the server started.

#### Example return data
```json
{
	"exam_mode_hosts": [
		"f1r1s1.codam.nl",
		"f1r2s1.codam.nl",
		"f1r3s1.codam.nl"
	],
	"message": "Exams in progress: 42042",
	"status": "ok"
}
```

```json
{
	"exam_mode_hosts": [],
	"message": "No exams are currently running",
	"status": "ok"
}
```
