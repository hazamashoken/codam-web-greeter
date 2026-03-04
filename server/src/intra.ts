import Fast42 from '@codam/fast42';
import { Event42, Exam42 } from './interfaces.js';

const CAMPUS_ID = process.env.INTRA_CAMPUS_ID;
const FETCH_EVENTS_UPCOMING_DAYS = 21; // 3 weeks
const INTRA_FETCH_RETRY_COUNT = Number(process.env.INTRA_FETCH_RETRY_COUNT ?? '3');
const INTRA_FETCH_RETRY_DELAY_MS = Number(process.env.INTRA_FETCH_RETRY_DELAY_MS ?? '1000');
const INTRA_FETCH_RETRY_BACKOFF_FACTOR = Number(process.env.INTRA_FETCH_RETRY_BACKOFF_FACTOR ?? '2');
const EVENT_KINDS_FILTER = [
	'rush', 'piscine', 'partnership', // pedago
	'conference', 'meet_up', 'event', // event
	'association', // association (student's club)
	'hackathon', 'workshop', 'challenge', // speed working
	'extern', // other
];

const normalizePositiveNumber = function(value: number, fallback: number): number {
	if (!Number.isFinite(value) || value <= 0) {
		return fallback;
	}
	return value;
};

const RETRY_COUNT_NORMALIZED = Math.floor(normalizePositiveNumber(INTRA_FETCH_RETRY_COUNT, 3));
const RETRY_DELAY_MS_NORMALIZED = Math.floor(normalizePositiveNumber(INTRA_FETCH_RETRY_DELAY_MS, 1000));
const RETRY_BACKOFF_NORMALIZED = normalizePositiveNumber(INTRA_FETCH_RETRY_BACKOFF_FACTOR, 2);

const getErrorMessage = function(err: unknown): string {
	if (err instanceof Error) {
		return err.message;
	}
	return String(err);
};

const sleep = async function(ms: number): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, ms));
};

const withRetry = async function<T>(operationName: string, operation: () => Promise<T>): Promise<T> {
	const maxAttempts = Math.max(1, RETRY_COUNT_NORMALIZED);
	let attempt = 0;
	let retryDelayMs = RETRY_DELAY_MS_NORMALIZED;
	let lastError: unknown;

	while (attempt < maxAttempts) {
		attempt += 1;
		try {
			return await operation();
		}
		catch (err) {
			lastError = err;
			if (attempt >= maxAttempts) {
				break;
			}
			console.warn(`[intra] ${operationName} attempt ${attempt}/${maxAttempts} failed, retrying in ${retryDelayMs}ms: ${getErrorMessage(err)}`);
			await sleep(retryDelayMs);
			retryDelayMs = Math.max(1, Math.floor(retryDelayMs * RETRY_BACKOFF_NORMALIZED));
		}
	}

	throw new Error(`[intra] ${operationName} failed after ${maxAttempts} attempts: ${getErrorMessage(lastError)}`);
};

const fetchAll42 = async function(api: Fast42, path: string, params: { [key: string]: string } = {}): Promise<any[]> {
	const pages = await api.getAllPages(path, params);
	console.log(`Retrieving API items: ${pages.length} pages for path ${path}`);

	// Fetch all pages
	let i = 0;
	const pageItems = await Promise.all(pages.map(async (page) => {
		console.log(`Fetching page ${++i}/${pages.length}`);
		const p = await page;
		if (p.status === 429) {
			throw new Error('Intra API rate limit exceeded');
		}
		if (p.ok) {
			const data = await p.json();
			return data;
		}
		throw new Error(`Intra API error: ${p.status} ${p.statusText}`);
	}));
	return pageItems.flat();
};

const getEventDateRange = function(): string {
	const currentDate = new Date();
	const maxFetchDate = new Date(currentDate.getTime() + 1000 * 60 * 60 * 24 * 365); // 1 year into the future
	return `${currentDate.toISOString()},${maxFetchDate.toISOString()}`;
};

const filterExamOrEventOnDate = function(items: Exam42[] | Event42[]) {
	// Delete events that are over the limit specified in the global variable
	const currentDate = new Date();
	const maxFetchDate = new Date(currentDate.getTime() + 1000 * 60 * 60 * 24 * FETCH_EVENTS_UPCOMING_DAYS);
	// @ts-ignore (This expression is not callable -> each member of union type has signatures, but none of those signatures are compatible with each other)
	const filteredItems = items.filter((item: Exam42 | Event42) => {
		const eventDate = new Date(item.begin_at);
		return eventDate.getTime() <= maxFetchDate.getTime();
	});
	return filteredItems;
}


export const fetchEvents = async function(api: Fast42): Promise<Event42[]> {
	try {
		const range = getEventDateRange();
		const intraEvents = await withRetry('fetchEvents', () =>
			fetchAll42(api, `/campus/${CAMPUS_ID}/events`, { 'range[end_at]': range, 'filter[kind]': EVENT_KINDS_FILTER.join(',') })
		);

		// Convert to Event42 objects
		const events42: Event42[] = intraEvents.map((item) => {
			return new Event42(item);
		});

		// Remove events too far into the future
		const filteredEvents = filterExamOrEventOnDate(events42) as Event42[];

		if (filteredEvents.length === 0) {
			console.log("No events found");
			return [];
		}

		filteredEvents.sort((a, b) => {
			return a.begin_at.getTime() - b.begin_at.getTime();
		});
		console.log(`Fetched ${filteredEvents.length} events`);
		return filteredEvents;
	}
	catch(err) {
		throw new Error(`Failed fetching events: ${getErrorMessage(err)}`);
	}
};

export const fetchExams = async function(api: Fast42): Promise<Exam42[]> {
	try {
		const range = getEventDateRange();
		const intraExams = await withRetry('fetchExams', () =>
			fetchAll42(api, `/campus/${CAMPUS_ID}/exams`, { 'range[end_at]': range, 'filter[visible]': 'true' })
		);

		// Convert to Exam42 objects
		const exams42: Exam42[] = intraExams.map((item) => {
			return new Exam42(item);
		});

		// Remove exams too far into the future
		const filteredExams = filterExamOrEventOnDate(exams42) as Exam42[];

		if (filteredExams.length === 0) {
			console.log("No exams found");
			return [];
		}

		filteredExams.sort((a, b) => {
			return a.begin_at.getTime() - b.begin_at.getTime();
		});
		console.log(`Fetched ${filteredExams.length} exams`);
		return filteredExams;
	}
	catch(err) {
		throw new Error(`Failed fetching exams: ${getErrorMessage(err)}`);
	}
};

export const fetchUserImage = async function(api: Fast42, login: string): Promise<string | null> {
	try {
		const req = await withRetry('fetchUserImage', async () => {
			const userRequest = await api.get(`/users/`, {
				'filter[login]': login, // Filtering instead of querying for the specific user is faster
			});
			if (userRequest.status === 429) {
				throw new Error('Intra API rate limit exceeded');
			}
			if (!userRequest.ok) {
				throw new Error(`Intra API error: ${userRequest.status} ${userRequest.statusText}`);
			}
			return userRequest;
		});

		const data = await req.json();
		if (data.length === 0) {
			return null;
		}
		const user = data[0];
		if (!user.image) {
			return null;
		}
		if (user.image.versions && user.image.versions.large) {
			return user.image.versions.large;
		}
		return user.image.link ?? null;
	}
	catch (err) {
		throw new Error(`Failed fetching user image for ${login}: ${getErrorMessage(err)}`);
	}
}
