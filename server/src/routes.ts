import { Express, NextFunction, Request, Response } from 'express';
import { Config, ConfigError, Event42, Exam42 } from './interfaces';
import { getCurrentExams, getExamForHostName, getHostNameFromRequest, getIpFromRequest, hostNameToIp, examAvailableForHost, getMessageForHostName } from './utils';
import { fetchEvents, fetchExams, fetchUserImage } from './intra';

// Intra API
import Fast42 from '@codam/fast42';
let api: Fast42 | undefined = undefined;

// Set up caching
import NodeCache from 'node-cache';
const cacheTTL = 900; // 15 minutes
const cache = new NodeCache({ stdTTL: cacheTTL });

const FOUND_HOSTS = new Set<string>();
const rateLimitCache = new NodeCache({ stdTTL: 60, useClones: false });

const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS ?? '60000');
const RATE_LIMIT_CONFIG_MAX = Number(process.env.RATE_LIMIT_CONFIG_MAX ?? '60');
const RATE_LIMIT_USER_IMAGE_MAX = Number(process.env.RATE_LIMIT_USER_IMAGE_MAX ?? '30');
const READINESS_MAX_CACHE_AGE_SECONDS = Number(process.env.READINESS_MAX_CACHE_AGE_SECONDS ?? '3600');
const INTRA_INIT_RETRY_DELAY_MS = Number(process.env.INTRA_INIT_RETRY_DELAY_MS ?? '60000');
const API_KEY = process.env.API_KEY?.trim();

let intraInitInProgress = false;
let intraInitLastSuccessAt: Date | null = null;
let intraInitLastError: string | null = null;
let intraRetryTimeout: ReturnType<typeof setTimeout> | null = null;

interface RateLimitEntry {
	count: number;
	resetAt: number;
}

const normalizePositiveInteger = function(value: number, fallback: number): number {
	if (!Number.isFinite(value) || value <= 0) {
		return fallback;
	}
	return Math.floor(value);
};

const RATE_LIMIT_WINDOW_MS_NORMALIZED = normalizePositiveInteger(RATE_LIMIT_WINDOW_MS, 60000);
const RATE_LIMIT_CONFIG_MAX_NORMALIZED = normalizePositiveInteger(RATE_LIMIT_CONFIG_MAX, 60);
const RATE_LIMIT_USER_IMAGE_MAX_NORMALIZED = normalizePositiveInteger(RATE_LIMIT_USER_IMAGE_MAX, 30);
const READINESS_MAX_CACHE_AGE_SECONDS_NORMALIZED = normalizePositiveInteger(READINESS_MAX_CACHE_AGE_SECONDS, 3600);
const INTRA_INIT_RETRY_DELAY_MS_NORMALIZED = normalizePositiveInteger(INTRA_INIT_RETRY_DELAY_MS, 60000);

const getErrorMessage = function(err: unknown): string {
	if (err instanceof Error) {
		return err.message;
	}
	return String(err);
};

const buildRateLimiter = function(scope: string, maxRequests: number) {
	return function(req: Request, res: Response, next: NextFunction): void {
		const clientIp = getIpFromRequest(req) ?? 'unknown';
		const cacheKey = `ratelimit:${scope}:${clientIp}`;
		const now = Date.now();
		const windowMs = RATE_LIMIT_WINDOW_MS_NORMALIZED;

		let entry = rateLimitCache.get<RateLimitEntry>(cacheKey);
		if (!entry || entry.resetAt <= now) {
			entry = { count: 0, resetAt: now + windowMs };
		}

		entry.count += 1;
		const ttlSeconds = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
		rateLimitCache.set(cacheKey, entry, ttlSeconds);

		const remaining = Math.max(0, maxRequests - entry.count);
		res.setHeader('X-RateLimit-Limit', maxRequests.toString());
		res.setHeader('X-RateLimit-Remaining', remaining.toString());
		res.setHeader('X-RateLimit-Reset', Math.ceil(entry.resetAt / 1000).toString());

		if (entry.count > maxRequests) {
			res.setHeader('Retry-After', ttlSeconds.toString());
			res.status(429).send({ error: 'Too many requests, please retry later' });
			return;
		}

		next();
	};
};

const requireApiKeyIfConfigured = function(req: Request, res: Response, next: NextFunction): void {
	if (!API_KEY) {
		next();
		return;
	}

	const headerApiKey = req.headers['x-api-key'];
	const providedApiKey = typeof headerApiKey === 'string'
		? headerApiKey
		: Array.isArray(headerApiKey) ? headerApiKey[0] : undefined;

	const authHeader = req.headers.authorization;
	const providedBearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length).trim() : undefined;

	if (providedApiKey === API_KEY || providedBearerToken === API_KEY) {
		next();
		return;
	}

	res.status(401).send({ error: 'Unauthorized' });
};

const configRateLimiter = buildRateLimiter('config', RATE_LIMIT_CONFIG_MAX_NORMALIZED);
const userImageRateLimiter = buildRateLimiter('user-image', RATE_LIMIT_USER_IMAGE_MAX_NORMALIZED);

export default (app: Express) => {
	// Initialize
	void setUpIntraAPI();

	// Define routes
	app.get('/', (req, res) => {
		res.send({ status: 'ok' });
	});

	app.get('/health/live', (req, res) => {
		return res.send({
			status: 'ok',
			uptime_seconds: Math.floor(process.uptime()),
		});
	});

	app.get('/health/ready', (req, res) => {
		const events = cache.get<Event42[]>('events');
		const exams = cache.get<Exam42[]>('exams');
		const lastCacheChange = cache.get<Date>('last-cache-change');
		const cacheAgeSeconds = lastCacheChange instanceof Date
			? Math.floor((Date.now() - lastCacheChange.getTime()) / 1000)
			: null;

		const ready = Boolean(api)
			&& Boolean(events)
			&& Boolean(exams)
			&& cacheAgeSeconds !== null
			&& cacheAgeSeconds <= READINESS_MAX_CACHE_AGE_SECONDS_NORMALIZED
			&& !intraInitInProgress;

		const payload = {
			status: ready ? 'ok' : 'not-ready',
			intra_api_ready: Boolean(api),
			intra_init_in_progress: intraInitInProgress,
			intra_last_success_at: intraInitLastSuccessAt,
			intra_last_error: intraInitLastError,
			cache: {
				events: Array.isArray(events) ? events.length : null,
				exams: Array.isArray(exams) ? exams.length : null,
				last_cache_change: lastCacheChange ?? null,
				cache_age_seconds: cacheAgeSeconds,
				max_cache_age_seconds: READINESS_MAX_CACHE_AGE_SECONDS_NORMALIZED,
			},
		};

		if (!ready) {
			return res.status(503).send(payload);
		}
		return res.send(payload);
	});

	app.get('/api/config/:hostname?', requireApiKeyIfConfigured, configRateLimiter, async (req, res) => {
		if (!api && !intraInitInProgress) {
			void setUpIntraAPI();
		}

		const hostname = await getHostNameFromRequest(req);

		let events = cache.get<Event42[]>('events');
		let exams = cache.get<Exam42[]>('exams');
		let lastCacheChange = cache.get<Date>('last-cache-change');

		if (!events && api) {
			events = await fetchEvents(api);
			cache.set('events', events);
			cache.set('last-cache-change', new Date());
		}
		if (!exams && api) {
			exams = await fetchExams(api);
			cache.set('exams', exams);
			cache.set('last-cache-change', new Date());
		}

		if (events === undefined || exams === undefined) {
			console.log('No data to return for config request');
			const cError: ConfigError = { error: 'No data to return, try again later' };
			return res.status(503).send(cError);
		}

		if (!FOUND_HOSTS.has(hostname)) {
			console.log(`Found new hostname: ${hostname}`);
			FOUND_HOSTS.add(hostname);
		}

		const config: Config = {
			hostname: hostname,
			events: events,
			exams: exams,
			exams_for_host: await getExamForHostName(exams, hostname),
			fetch_time: lastCacheChange ?? new Date(),
			message: await getMessageForHostName(hostname),
		};
		res.send(config);
	});

	app.get('/api/exam_mode_hosts', requireApiKeyIfConfigured, async (req, res) => {
		if (!api && !intraInitInProgress) {
			void setUpIntraAPI();
		}

		// Check cache first
		if (cache.has('examModeHosts')) {
			const ret = cache.get<any>('examModeHosts')
			return res.send(ret);
		}

		// Get the current exams
		let exams = cache.get<Exam42[]>('exams');
		if (!exams && api) {
			exams = await fetchExams(api);
			cache.set('exams', exams);
			cache.set('last-cache-change', new Date());
		}
		if (exams === undefined) {
			return res.status(503).send({ error: 'No data to return, try again later', status: 'error' });
		}
		const currentExams = getCurrentExams(exams);
		if (currentExams.length === 0) {
			return res.send({ exam_mode_hosts: [], message: 'No exams are currently running', status: 'ok' });
		}

		// Calculate which hosts are in exam mode
		const examModeHosts: string[] = [];
		for (const hostname of FOUND_HOSTS.values()) {
			const ipAddress = await hostNameToIp(hostname);
			if (!ipAddress) {
				continue;
			}
			for (const exam of currentExams) {
				if (examAvailableForHost(exam, ipAddress)) {
					examModeHosts.push(hostname);
					break;
				}
			}
		}

		// Save to cache and return data
		const examsInProgressIds = currentExams.map((exam) => exam.id);
		const ret = { exam_mode_hosts: examModeHosts, message: `Exams in progress: ${examsInProgressIds.join(', ')}`, status: 'ok' }
		cache.set('examModeHosts', ret, 5); // 5 second cache
		return res.send(ret);
	});

	app.get('/api/user/:login/.face', requireApiKeyIfConfigured, userImageRateLimiter, async (req, res) => {
		if (!api && !intraInitInProgress) {
			void setUpIntraAPI();
		}

		const login = req.params.login;
		if (!login) {
			return res.status(400).send({ error: 'No login provided' });
		}
		if (!api) {
			return res.status(503).send({ error: 'Intra API not initialized' });
		}
		if (cache.has(`user-image-${login}`)) {
			const imageUrl = cache.get<string>(`user-image-${login}`);
			if (imageUrl) {
				return res.redirect(imageUrl);
			}
		}
		const imageUrl = await fetchUserImage(api, login);
		if (!imageUrl) {
			return res.status(404).send({ error: 'User not found or no image set' });
		}
		cache.set(`user-image-${login}`, imageUrl, cacheTTL); // Cache the image URL
		return res.redirect(imageUrl);
	});
};

const setUpIntraAPI = async function() {
	if (intraInitInProgress) {
		return;
	}

	intraInitInProgress = true;
	try {
		if (!process.env.INTRA_API_UID || !process.env.INTRA_API_SECRET) {
			throw new Error('Missing INTRA_API_UID or INTRA_API_SECRET');
		}

		api = await new Fast42([{
			client_id: process.env.INTRA_API_UID!,
			client_secret: process.env.INTRA_API_SECRET!,
		}]).init();

		// Fetch initial data
		if (!cache.has('events')) {
			const events = await fetchEvents(api);
			console.log('Fetched future events');
			cache.set('events', events);
			cache.set('last-cache-change', new Date());
		}

		if (!cache.has('exams')) {
			const exams = await fetchExams(api);
			console.log('Fetched future exams');
			cache.set('exams', exams);
			cache.set('last-cache-change', new Date());
		}

		intraInitLastSuccessAt = new Date();
		intraInitLastError = null;

		if (intraRetryTimeout) {
			clearTimeout(intraRetryTimeout);
			intraRetryTimeout = null;
		}
	}
	catch(err) {
		console.warn("[WARNING] Could not initialize Intra API, some features might not work");
		console.error(err);
		api = undefined; // unset api
		intraInitLastError = getErrorMessage(err);

		if (!intraRetryTimeout) {
			intraRetryTimeout = setTimeout(() => {
				intraRetryTimeout = null;
				void setUpIntraAPI();
			}, INTRA_INIT_RETRY_DELAY_MS_NORMALIZED);
		}
	}
	finally {
		intraInitInProgress = false;
	}
};
