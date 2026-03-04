var path = require('path');

module.exports = (env, argv) => {
	const isProduction = argv.mode === 'production';

	return {
		watch: false,
		target: 'electron-renderer',
		mode: isProduction ? 'production' : 'development',
		devtool: isProduction ? false : 'inline-source-map',
		entry: './client/main.ts',
		output: {
			path: path.resolve(__dirname, 'dist'),
			filename: 'bundle.js'
		},
		resolve: {
			extensions: [ '.ts', '.js' ]
		},
		module: {
			rules: [
				// all files with a `.ts` or `.tsx` extension will be handled by `ts-loader`
				{ test: /\.tsx?$/, loader: "ts-loader" }
			]
		}
	};
};
