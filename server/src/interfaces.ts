import { parseIpRanges } from "./utils";

export class Event42 {
	id: number;
	name: string;
	description: string;
	location: string | null;
	kind: string;
	max_people: number | null;
	nbr_subscribers: number;
	begin_at: Date;
	end_at: Date;
	campus_ids: number[];
	cursus_ids: number[];
	created_at: Date;
	updated_at: Date;

	constructor(data: any) {
		this.id = data['id'] ?? 0;
		this.name = data['name'] ?? 'Event';
		this.description = data['description'] ?? 'No description';
		this.location = data['location'] ?? null;
		this.kind = data['kind'] ?? 'unknown';
		this.max_people = data['max_people'] ?? null;
		this.nbr_subscribers = data['nbr_subscribers'] ?? 0;
		this.begin_at = new Date(data['begin_at']) ?? new Date();
		this.end_at = new Date(data['end_at']) ?? this.begin_at ?? new Date();
		this.campus_ids = data['campus_ids'] ?? [];
		this.cursus_ids = data['cursus_ids'] ?? [];
		this.created_at = new Date(data['created_at']) ?? new Date();
		this.updated_at = new Date(data['updated_at']) ?? new Date();
	}
}

export class Cursus42 {
	id: number;
	name: string;
	slug: string;

	constructor(data: any) {
		this.id = data['id'] ?? 0;
		this.name = data['name'] ?? 'Cursus';
		this.slug = data['slug'] ?? 'unknown-cursus';
	}
}

export class Project42 {
	id: number;
	name: string;
	slug: string;

	constructor(data: any) {
		this.id = data['id'] ?? 0;
		this.name = data['name'] ?? 'Project';
		this.slug = data['slug'] ?? 'unknown-project';
	}
}

export class Exam42 {
	id: number;
	ip_range: string[];
	begin_at: Date;
	end_at: Date;
	location: string;
	max_people: number | null;
	nbr_subscribers: number;
	name: string;
	created_at: Date;
	updated_at: Date;
	cursus: Cursus42[] = [];
	projects: Project42[] = [];

	constructor(data: any) {
		this.id = data['id'] ?? 0;
		this.ip_range = typeof data['ip_range'] === 'string' ? parseIpRanges(data['ip_range']) : [];
		this.begin_at = new Date(data['begin_at']) ?? new Date();
		this.end_at = new Date(data['end_at']) ?? this.begin_at ?? new Date();
		this.location = data['location'] ?? 'Unknown location';
		this.max_people = data['max_people'] ?? null;
		this.nbr_subscribers = data['nbr_subscribers'] ?? 0;
		this.name = data['name'] ?? 'Exam';
		this.created_at = new Date(data['created_at']) ?? new Date();
		this.updated_at = new Date(data['updated_at']) ?? new Date();
		const cursusData = Array.isArray(data['cursus']) ? data['cursus'] : [];
		const projectsData = Array.isArray(data['projects']) ? data['projects'] : [];
		if (cursusData.length > 0) {
			this.cursus = cursusData.map((cursus: any) => {
				return new Cursus42(cursus);
			});
			// Remove duplicates
			this.cursus = this.cursus.filter((cursus, index, self) =>
				index === self.findIndex((c) => (
					c.id === cursus.id
				))
			);
		}
		if (projectsData.length > 0) {
			this.projects = projectsData.map((project: any) => {
				return new Project42(project);
			});
		}
	}
}

export interface ExamForHost {
	id: number;
	name: string;
	begin_at: Date;
	end_at: Date;
}

/**
 * The Config interface is used to send data to the client.
 * It contains all the data the client needs to display the lock screen.
 * @string hostname The hostname of the client
 * @array events All events
 * @array exams All exams
 * @array exams_for_host All exams available to the client
 * @date fetch_time When the Intra data (events, exams) was last fetched from the API
 * @string message Custom message do display on the login screen
 */
export interface Config {
	hostname: string;
	events: Event42[];
	exams: Exam42[];
	exams_for_host: ExamForHost[];
	fetch_time: Date;
	message: string;
}

export interface ConfigError {
	error: string;
}

export interface Event42Response {
	id: number;
	name: string;
	description: string;
	location: string | null;
	kind: string;
	max_people: number | null;
	nbr_subscribers: number;
	begin_at: string;
	end_at: string;
	campus_ids: number[];
	cursus_ids: number[];
	created_at: string;
	updated_at: string;
}

export interface Cursus42Response {
	id: number;
	name: string;
	slug: string;
}

export interface Project42Response {
	id: number;
	name: string;
	slug: string;
}

export interface Exam42Response {
	cursus: Cursus42Response[];
	projects: Project42Response[];
	id: number;
	ip_range: string[];
	begin_at: string;
	end_at: string;
	location: string | null;
	max_people: number | null;
	nbr_subscribers: number;
	name: string;
	created_at: string;
	updated_at: string;
}

export interface ExamForHostResponse {
	id: number;
	name: string;
	begin_at: string;
	end_at: string;
}

export interface ConfigResponse {
	hostname: string;
	events: Event42Response[];
	exams: Exam42Response[];
	exams_for_host: ExamForHostResponse[];
	fetch_time: string;
	message: string;
	degraded?: boolean;
	warnings?: string[];
}

const isRecord = function(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
};

const isString = function(value: unknown): value is string {
	return typeof value === 'string';
};

const isFiniteNumber = function(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value);
};

const isStringArray = function(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((item) => typeof item === 'string');
};

const isNumberArray = function(value: unknown): value is number[] {
	return Array.isArray(value) && value.every((item) => isFiniteNumber(item));
};

const toIsoString = function(value: Date | string | null | undefined): string {
	if (!value) {
		return new Date(0).toISOString();
	}
	if (typeof value === 'string') {
		const parsed = new Date(value);
		return Number.isNaN(parsed.getTime()) ? new Date(0).toISOString() : parsed.toISOString();
	}
	return Number.isNaN(value.getTime()) ? new Date(0).toISOString() : value.toISOString();
};

const eventToResponse = function(event: Event42): Event42Response {
	return {
		id: event.id,
		name: event.name,
		description: event.description,
		location: event.location,
		kind: event.kind,
		max_people: event.max_people,
		nbr_subscribers: event.nbr_subscribers,
		begin_at: toIsoString(event.begin_at),
		end_at: toIsoString(event.end_at),
		campus_ids: event.campus_ids,
		cursus_ids: event.cursus_ids,
		created_at: toIsoString(event.created_at),
		updated_at: toIsoString(event.updated_at),
	};
};

const examToResponse = function(exam: Exam42): Exam42Response {
	return {
		cursus: exam.cursus.map((cursus) => ({
			id: cursus.id,
			name: cursus.name,
			slug: cursus.slug,
		})),
		projects: exam.projects.map((project) => ({
			id: project.id,
			name: project.name,
			slug: project.slug,
		})),
		id: exam.id,
		ip_range: exam.ip_range,
		begin_at: toIsoString(exam.begin_at),
		end_at: toIsoString(exam.end_at),
		location: exam.location,
		max_people: exam.max_people,
		nbr_subscribers: exam.nbr_subscribers,
		name: exam.name,
		created_at: toIsoString(exam.created_at),
		updated_at: toIsoString(exam.updated_at),
	};
};

const examForHostToResponse = function(exam: ExamForHost): ExamForHostResponse {
	return {
		id: exam.id,
		name: exam.name,
		begin_at: toIsoString(exam.begin_at),
		end_at: toIsoString(exam.end_at),
	};
};

export const toConfigResponse = function(config: Config, options: { degraded?: boolean; warnings?: string[] } = {}): ConfigResponse {
	return {
		hostname: config.hostname,
		events: config.events.map(eventToResponse),
		exams: config.exams.map(examToResponse),
		exams_for_host: config.exams_for_host.map(examForHostToResponse),
		fetch_time: toIsoString(config.fetch_time),
		message: config.message,
		degraded: options.degraded,
		warnings: options.warnings,
	};
};

export const validateConfigResponse = function(payload: unknown): { valid: boolean; errors: string[] } {
	const errors: string[] = [];
	if (!isRecord(payload)) {
		return { valid: false, errors: ['Payload is not an object'] };
	}

	if (!isString(payload.hostname)) {
		errors.push('hostname must be a string');
	}
	if (!Array.isArray(payload.events)) {
		errors.push('events must be an array');
	}
	if (!Array.isArray(payload.exams)) {
		errors.push('exams must be an array');
	}
	if (!Array.isArray(payload.exams_for_host)) {
		errors.push('exams_for_host must be an array');
	}
	if (!isString(payload.fetch_time)) {
		errors.push('fetch_time must be an ISO string');
	}
	if (!isString(payload.message)) {
		errors.push('message must be a string');
	}

	if (Array.isArray(payload.events)) {
		payload.events.forEach((event, index) => {
			if (!isRecord(event)) {
				errors.push(`events[${index}] must be an object`);
				return;
			}
			if (!isFiniteNumber(event.id) || !isString(event.name) || !isString(event.kind) || !isString(event.begin_at) || !isString(event.end_at)) {
				errors.push(`events[${index}] has invalid required fields`);
			}
			if (!isNumberArray(event.campus_ids) || !isNumberArray(event.cursus_ids)) {
				errors.push(`events[${index}] campus_ids/cursus_ids must be number arrays`);
			}
		});
	}

	if (Array.isArray(payload.exams)) {
		payload.exams.forEach((exam, index) => {
			if (!isRecord(exam)) {
				errors.push(`exams[${index}] must be an object`);
				return;
			}
			if (!isFiniteNumber(exam.id) || !isString(exam.name) || !isString(exam.begin_at) || !isString(exam.end_at)) {
				errors.push(`exams[${index}] has invalid required fields`);
			}
			if (!isStringArray(exam.ip_range)) {
				errors.push(`exams[${index}].ip_range must be a string array`);
			}
			if (!Array.isArray(exam.cursus) || !Array.isArray(exam.projects)) {
				errors.push(`exams[${index}] cursus/projects must be arrays`);
			}
		});
	}

	if (Array.isArray(payload.exams_for_host)) {
		payload.exams_for_host.forEach((exam, index) => {
			if (!isRecord(exam)) {
				errors.push(`exams_for_host[${index}] must be an object`);
				return;
			}
			if (!isFiniteNumber(exam.id) || !isString(exam.name) || !isString(exam.begin_at) || !isString(exam.end_at)) {
				errors.push(`exams_for_host[${index}] has invalid required fields`);
			}
		});
	}

	if ('degraded' in payload && payload.degraded !== undefined && typeof payload.degraded !== 'boolean') {
		errors.push('degraded must be a boolean when provided');
	}
	if ('warnings' in payload && payload.warnings !== undefined && !isStringArray(payload.warnings)) {
		errors.push('warnings must be a string array when provided');
	}

	return { valid: errors.length === 0, errors };
};
