import dotenv from 'dotenv';
dotenv.config({ path: '.env', debug: process.env.NODE_ENV !== 'production' }); // Load .env file

import express from 'express';

// Set up express app
const app = express();

const parseTrustProxy = function(value: string): boolean | number | string {
	const trustProxy = value.trim().toLowerCase();
	if (trustProxy === 'true') {
		return true;
	}
	if (trustProxy === 'false') {
		return false;
	}
	if (/^\d+$/.test(trustProxy)) {
		return Number(trustProxy);
	}
	return value;
};

const trustProxy = parseTrustProxy(process.env.TRUST_PROXY ?? 'loopback, linklocal, uniquelocal');
app.set('trust proxy', trustProxy);

// Set up express middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Set up express routes
import routes from './routes.js';
routes(app);

// Start server
app.listen(3000, async () => {
	console.log('Server is running on port 3000');
});
