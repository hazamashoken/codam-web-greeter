import { Express, NextFunction, Request, Response } from 'express';
import { Config, ConfigError, Event42, Exam42, toConfigResponse, validateConfigResponse } from './interfaces';
import { getCurrentExams, getExamForHostName, getHostNameFromRequest, getIpFromRequest, hostNameToIp, examAvailableForHost, getMessageForHostName } from './utils';
import { fetchEvents, fetchExams, fetchUserImage } from './intra';

// Intra API
import Fast42 from '@codam/fast42';
let api: Fast42 | undefined = undefined;

// Set up caching
import NodeCache from 'node-cache';
const cacheTTL = 900; // 15 minutes
const cache = new NodeCache({ stdTTL: cacheTTL });

const EVENTS_CACHE_KEY = 'events';
const EXAMS_CACHE_KEY = 'exams';
const EVENTS_FETCHED_AT_KEY = 'events-fetched-at';
const EXAMS_FETCHED_AT_KEY = 'exams-fetched-at';

const FOUND_HOSTS = new Set<string>();
const rateLimitCache = new NodeCache({ stdTTL: 60, useClones: false });

const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS ?? '60000');
const RATE_LIMIT_CONFIG_MAX = Number(process.env.RATE_LIMIT_CONFIG_MAX ?? '60');
const RATE_LIMIT_USER_IMAGE_MAX = Number(process.env.RATE_LIMIT_USER_IMAGE_MAX ?? '30');
const READINESS_MAX_CACHE_AGE_SECONDS = Number(process.env.READINESS_MAX_CACHE_AGE_SECONDS ?? '3600');
const INTRA_INIT_RETRY_DELAY_MS = Number(process.env.INTRA_INIT_RETRY_DELAY_MS ?? '60000');
const INTRA_REFRESH_INTERVAL_SECONDS = Number(process.env.INTRA_REFRESH_INTERVAL_SECONDS ?? '300');
const INTRA_MAX_STALE_DATA_SECONDS = Number(process.env.INTRA_MAX_STALE_DATA_SECONDS ?? '86400');
const API_KEY = process.env.API_KEY?.trim();

let intraInitInProgress = false;
let intraInitLastSuccessAt: Date | null = null;
let intraInitLastError: string | null = null;
let intraRetryTimeout: ReturnType<typeof setTimeout> | null = null;

interface RateLimitEntry {
	count: number;
	resetAt: number;
}

interface EndpointMetric {
	count: number;
	error_count: number;
	total_ms: number;
	max_ms: number;
}

interface DatasetMetric {
	hits: number;
	misses: number;
	refresh_success: number;
	refresh_failures: number;
	stale_served: number;
}

interface DatasetRefreshResult<T> {
	data: T[] | undefined;
	degraded: boolean;
	warning: string | null;
	age_seconds: number | null;
	source: 'fresh' | 'cache' | 'stale' | 'none';
}

const metricsState = {
	started_at: new Date(),
	cache: {
		events: { hits: 0, misses: 0, refresh_success: 0, refresh_failures: 0, stale_served: 0 } as DatasetMetric,
		exams: { hits: 0, misses: 0, refresh_success: 0, refresh_failures: 0, stale_served: 0 } as DatasetMetric,
		user_image_hits: 0,
		user_image_misses: 0,
	},
	upstream: {
		consecutive_failures: 0,
		total_failures: 0,
		last_error: null as string | null,
		last_failure_at: null as Date | null,
		last_success_at: null as Date | null,
	},
	endpoints: {} as Record<string, EndpointMetric>,
};

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
const INTRA_REFRESH_INTERVAL_SECONDS_NORMALIZED = normalizePositiveInteger(INTRA_REFRESH_INTERVAL_SECONDS, 300);
const INTRA_MAX_STALE_DATA_SECONDS_NORMALIZED = normalizePositiveInteger(INTRA_MAX_STALE_DATA_SECONDS, 86400);

const getErrorMessage = function(err: unknown): string {
	if (err instanceof Error) {
		return err.message;
	}
	return String(err);
};

const logEvent = function(level: 'info' | 'warn' | 'error', event: string, fields: Record<string, unknown> = {}): void {
	const payload = {
		ts: new Date().toISOString(),
		level,
		event,
		...fields,
	};
	const line = JSON.stringify(payload);
	if (level === 'error') {
		console.error(line);
	}
	else if (level === 'warn') {
		console.warn(line);
	}
	else {
		console.log(line);
	}
};

const observeEndpoint = function(metricName: string, durationMs: number, statusCode: number): void {
	const metric = metricsState.endpoints[metricName] ?? {
		count: 0,
		error_count: 0,
		total_ms: 0,
		max_ms: 0,
	};
	metric.count += 1;
	metric.total_ms += durationMs;
	metric.max_ms = Math.max(metric.max_ms, durationMs);
	if (statusCode >= 500) {
		metric.error_count += 1;
	}
	metricsState.endpoints[metricName] = metric;
};

const getDateFromCache = function(cacheKey: string): Date | null {
	const value = cache.get<Date>(cacheKey);
	if (value instanceof Date && !Number.isNaN(value.getTime())) {
		return value;
	}
	return null;
};

const getDatasetAgeSeconds = function(fetchedAtKey: string): number | null {
	const fetchedAt = getDateFromCache(fetchedAtKey);
	if (!fetchedAt) {
		return null;
	}
	return Math.max(0, Math.floor((Date.now() - fetchedAt.getTime()) / 1000));
};

const setDatasetCache = function<T>(datasetKey: string, fetchedAtKey: string, data: T[]): void {
	const now = new Date();
	cache.set(datasetKey, data, 0);
	cache.set(fetchedAtKey, now, 0);
	cache.set('last-cache-change', now, 0);
};

const markUpstreamSuccess = function(): void {
	metricsState.upstream.consecutive_failures = 0;
	metricsState.upstream.last_success_at = new Date();
};

const markUpstreamFailure = function(dataset: 'events' | 'exams' | 'user-image', err: unknown): void {
	metricsState.upstream.consecutive_failures += 1;
	metricsState.upstream.total_failures += 1;
	metricsState.upstream.last_error = `${dataset}: ${getErrorMessage(err)}`;
	metricsState.upstream.last_failure_at = new Date();
};

const refreshEvents = async function(force: boolean = false): Promise<DatasetRefreshResult<Event42>> {
	const cachedEvents = cache.get<Event42[]>(EVENTS_CACHE_KEY);
	const ageSeconds = getDatasetAgeSeconds(EVENTS_FETCHED_AT_KEY);
	const hasCachedEvents = Array.isArray(cachedEvents);
	const shouldRefresh = force || !hasCachedEvents || ageSeconds === null || ageSeconds >= INTRA_REFRESH_INTERVAL_SECONDS_NORMALIZED;

	if (!shouldRefresh && hasCachedEvents) {
		metricsState.cache.events.hits += 1;
		return {
			data: cachedEvents,
			degraded: false,
			warning: null,
			age_seconds: ageSeconds,
			source: 'cache',
		};
	}

	metricsState.cache.events.misses += 1;
	if (!api) {
		if (hasCachedEvents && (ageSeconds === null || ageSeconds <= INTRA_MAX_STALE_DATA_SECONDS_NORMALIZED)) {
			metricsState.cache.events.stale_served += 1;
			return {
				data: cachedEvents,
				degraded: true,
				warning: 'Serving stale events because Intra API is not initialized',
				age_seconds: ageSeconds,
				source: 'stale',
			};
		}
		return {
			data: undefined,
			degraded: true,
			warning: 'No events available and Intra API is not initialized',
			age_seconds: ageSeconds,
			source: 'none',
		};
	}

	try {
		const events = await fetchEvents(api);
		setDatasetCache(EVENTS_CACHE_KEY, EVENTS_FETCHED_AT_KEY, events);
		metricsState.cache.events.refresh_success += 1;
		markUpstreamSuccess();
		logEvent('info', 'events_cache_refresh_success', { count: events.length });
		return {
			data: events,
			degraded: false,
			warning: null,
			age_seconds: 0,
			source: 'fresh',
		};
	}
	catch (err) {
		metricsState.cache.events.refresh_failures += 1;
		markUpstreamFailure('events', err);
		logEvent('warn', 'events_cache_refresh_failed', { error: getErrorMessage(err) });
		if (hasCachedEvents && (ageSeconds === null || ageSeconds <= INTRA_MAX_STALE_DATA_SECONDS_NORMALIZED)) {
			metricsState.cache.events.stale_served += 1;
			return {
				data: cachedEvents,
				degraded: true,
				warning: `Serving stale events due to upstream failure: ${getErrorMessage(err)}`,
				age_seconds: ageSeconds,
				source: 'stale',
			};
		}
		return {
			data: undefined,
			degraded: true,
			warning: `No events available due to upstream failure: ${getErrorMessage(err)}`,
			age_seconds: ageSeconds,
			source: 'none',
		};
	}
};

const refreshExams = async function(force: boolean = false): Promise<DatasetRefreshResult<Exam42>> {
	const cachedExams = cache.get<Exam42[]>(EXAMS_CACHE_KEY);
	const ageSeconds = getDatasetAgeSeconds(EXAMS_FETCHED_AT_KEY);
	const hasCachedExams = Array.isArray(cachedExams);
	const shouldRefresh = force || !hasCachedExams || ageSeconds === null || ageSeconds >= INTRA_REFRESH_INTERVAL_SECONDS_NORMALIZED;

	if (!shouldRefresh && hasCachedExams) {
		metricsState.cache.exams.hits += 1;
		return {
			data: cachedExams,
			degraded: false,
			warning: null,
			age_seconds: ageSeconds,
			source: 'cache',
		};
	}

	metricsState.cache.exams.misses += 1;
	if (!api) {
		if (hasCachedExams && (ageSeconds === null || ageSeconds <= INTRA_MAX_STALE_DATA_SECONDS_NORMALIZED)) {
			metricsState.cache.exams.stale_served += 1;
			return {
				data: cachedExams,
				degraded: true,
				warning: 'Serving stale exams because Intra API is not initialized',
				age_seconds: ageSeconds,
				source: 'stale',
			};
		}
		return {
			data: undefined,
			degraded: true,
			warning: 'No exams available and Intra API is not initialized',
			age_seconds: ageSeconds,
			source: 'none',
		};
	}

	try {
		const exams = await fetchExams(api);
		setDatasetCache(EXAMS_CACHE_KEY, EXAMS_FETCHED_AT_KEY, exams);
		metricsState.cache.exams.refresh_success += 1;
		markUpstreamSuccess();
		logEvent('info', 'exams_cache_refresh_success', { count: exams.length });
		return {
			data: exams,
			degraded: false,
			warning: null,
			age_seconds: 0,
			source: 'fresh',
		};
	}
	catch (err) {
		metricsState.cache.exams.refresh_failures += 1;
		markUpstreamFailure('exams', err);
		logEvent('warn', 'exams_cache_refresh_failed', { error: getErrorMessage(err) });
		if (hasCachedExams && (ageSeconds === null || ageSeconds <= INTRA_MAX_STALE_DATA_SECONDS_NORMALIZED)) {
			metricsState.cache.exams.stale_served += 1;
			return {
				data: cachedExams,
				degraded: true,
				warning: `Serving stale exams due to upstream failure: ${getErrorMessage(err)}`,
				age_seconds: ageSeconds,
				source: 'stale',
			};
		}
		return {
			data: undefined,
			degraded: true,
			warning: `No exams available due to upstream failure: ${getErrorMessage(err)}`,
			age_seconds: ageSeconds,
			source: 'none',
		};
	}
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
	app.use((req, res, next) => {
		const start = process.hrtime.bigint();
		res.on('finish', () => {
			const elapsedMs = Number(process.hrtime.bigint() - start) / 1_000_000;
			const routePath = req.route?.path ? String(req.route.path) : req.path;
			observeEndpoint(`${req.method} ${routePath}`, elapsedMs, res.statusCode);
		});
		next();
	});

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
		const events = cache.get<Event42[]>(EVENTS_CACHE_KEY);
		const exams = cache.get<Exam42[]>(EXAMS_CACHE_KEY);
		const eventsAgeSeconds = getDatasetAgeSeconds(EVENTS_FETCHED_AT_KEY);
		const examsAgeSeconds = getDatasetAgeSeconds(EXAMS_FETCHED_AT_KEY);

		const ready = Boolean(api)
			&& Array.isArray(events)
			&& Array.isArray(exams)
			&& eventsAgeSeconds !== null
			&& examsAgeSeconds !== null
			&& eventsAgeSeconds <= READINESS_MAX_CACHE_AGE_SECONDS_NORMALIZED
			&& examsAgeSeconds <= READINESS_MAX_CACHE_AGE_SECONDS_NORMALIZED
			&& !intraInitInProgress;

		const degraded = metricsState.upstream.consecutive_failures > 0;

		const payload = {
			status: ready ? 'ok' : 'not-ready',
			degraded,
			intra_api_ready: Boolean(api),
			intra_init_in_progress: intraInitInProgress,
			intra_last_success_at: intraInitLastSuccessAt,
			intra_last_error: intraInitLastError,
			cache: {
				events: Array.isArray(events) ? events.length : null,
				exams: Array.isArray(exams) ? exams.length : null,
				events_age_seconds: eventsAgeSeconds,
				exams_age_seconds: examsAgeSeconds,
				max_cache_age_seconds: READINESS_MAX_CACHE_AGE_SECONDS_NORMALIZED,
				refresh_interval_seconds: INTRA_REFRESH_INTERVAL_SECONDS_NORMALIZED,
				max_stale_seconds: INTRA_MAX_STALE_DATA_SECONDS_NORMALIZED,
			},
			upstream: metricsState.upstream,
		};

		if (!ready) {
			return res.status(503).send(payload);
		}
		return res.send(payload);
	});

	app.get('/metrics', requireApiKeyIfConfigured, (req, res) => {
		const endpointMetrics = Object.fromEntries(Object.entries(metricsState.endpoints).map(([key, value]) => {
			const avgMs = value.count > 0 ? value.total_ms / value.count : 0;
			return [key, {
				count: value.count,
				error_count: value.error_count,
				avg_ms: Number(avgMs.toFixed(2)),
				max_ms: Number(value.max_ms.toFixed(2)),
			}];
		}));

		return res.send({
			status: 'ok',
			started_at: metricsState.started_at,
			uptime_seconds: Math.floor(process.uptime()),
			cache: {
				events_age_seconds: getDatasetAgeSeconds(EVENTS_FETCHED_AT_KEY),
				exams_age_seconds: getDatasetAgeSeconds(EXAMS_FETCHED_AT_KEY),
				refresh_interval_seconds: INTRA_REFRESH_INTERVAL_SECONDS_NORMALIZED,
				max_stale_seconds: INTRA_MAX_STALE_DATA_SECONDS_NORMALIZED,
				metrics: metricsState.cache,
			},
			upstream: metricsState.upstream,
			endpoints: endpointMetrics,
		});
	});

	app.get('/api/config/:hostname?', requireApiKeyIfConfigured, configRateLimiter, async (req, res) => {
		if (!api && !intraInitInProgress) {
			void setUpIntraAPI();
		}

		const hostname = await getHostNameFromRequest(req);
		const [eventsResult, examsResult] = await Promise.all([refreshEvents(), refreshExams()]);
		const warnings = [eventsResult.warning, examsResult.warning].filter((warning): warning is string => Boolean(warning));
		const degraded = eventsResult.degraded || examsResult.degraded || metricsState.upstream.consecutive_failures > 0;

		if (!eventsResult.data || !examsResult.data) {
			const cError: ConfigError & { warnings?: string[]; degraded?: boolean } = {
				error: 'No data to return, try again later',
				degraded,
			};
			if (warnings.length > 0) {
				cError.warnings = warnings;
			}
			logEvent('warn', 'config_response_unavailable', {
				hostname,
				warnings,
				events_source: eventsResult.source,
				exams_source: examsResult.source,
			});
			return res.status(503).send(cError);
		}

		if (!FOUND_HOSTS.has(hostname)) {
			logEvent('info', 'new_hostname_discovered', { hostname });
			FOUND_HOSTS.add(hostname);
		}

		const lastCacheChange = getDateFromCache('last-cache-change') ?? new Date();
		const config: Config = {
			hostname,
			events: eventsResult.data,
			exams: examsResult.data,
			exams_for_host: await getExamForHostName(examsResult.data, hostname),
			fetch_time: lastCacheChange,
			message: await getMessageForHostName(hostname),
		};

		const responsePayload = toConfigResponse(config, { degraded, warnings });
		const validation = validateConfigResponse(responsePayload);
		if (!validation.valid) {
			logEvent('error', 'config_response_validation_failed', {
				hostname,
				errors: validation.errors,
			});
			return res.status(503).send({
				error: 'Config data validation failed',
				degraded: true,
				warnings: validation.errors,
			});
		}

		if (degraded) {
			res.setHeader('X-Degraded-Mode', '1');
		}
		res.send(responsePayload);
	});

	app.get('/api/exam_mode_hosts', requireApiKeyIfConfigured, async (req, res) => {
		if (!api && !intraInitInProgress) {
			void setUpIntraAPI();
		}

		// Check cache first
		if (cache.has('examModeHosts')) {
			const ret = cache.get<any>('examModeHosts');
			return res.send(ret);
		}

		const examsResult = await refreshExams();
		if (!examsResult.data) {
			return res.status(503).send({
				error: 'No data to return, try again later',
				status: 'error',
				degraded: true,
				warnings: examsResult.warning ? [examsResult.warning] : [],
			});
		}

		const currentExams = getCurrentExams(examsResult.data);
		if (currentExams.length === 0) {
			return res.send({
				exam_mode_hosts: [],
				message: 'No exams are currently running',
				status: 'ok',
				degraded: examsResult.degraded,
			});
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

		const examsInProgressIds = currentExams.map((exam) => exam.id);
		const ret = {
			exam_mode_hosts: examModeHosts,
			message: `Exams in progress: ${examsInProgressIds.join(', ')}`,
			status: 'ok',
			degraded: examsResult.degraded,
		};
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
				metricsState.cache.user_image_hits += 1;
				return res.redirect(imageUrl);
			}
		}
		metricsState.cache.user_image_misses += 1;

		try {
			const imageUrl = await fetchUserImage(api, login);
			if (!imageUrl) {
				return res.status(404).send({ error: 'User not found or no image set' });
			}
			cache.set(`user-image-${login}`, imageUrl, cacheTTL); // Cache the image URL
			markUpstreamSuccess();
			return res.redirect(imageUrl);
		}
		catch (err) {
			markUpstreamFailure('user-image', err);
			logEvent('warn', 'user_image_fetch_failed', { login, error: getErrorMessage(err) });
			return res.status(503).send({ error: 'Failed fetching user image from upstream' });
		}
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

		const initializedApi = await new Fast42([{
			client_id: process.env.INTRA_API_UID!,
			client_secret: process.env.INTRA_API_SECRET!,
		}]).init();
		api = initializedApi;

		const [eventsResult, examsResult] = await Promise.all([refreshEvents(true), refreshExams(true)]);
		if (!eventsResult.data || !examsResult.data) {
			const details = [eventsResult.warning, examsResult.warning].filter(Boolean).join('; ');
			throw new Error(`Initial Intra refresh failed: ${details}`);
		}

		intraInitLastSuccessAt = new Date();
		intraInitLastError = null;

		if (intraRetryTimeout) {
			clearTimeout(intraRetryTimeout);
			intraRetryTimeout = null;
		}
	}
	catch (err) {
		const message = getErrorMessage(err);
		logEvent('warn', 'intra_api_initialization_failed', { error: message });
		intraInitLastError = message;

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
