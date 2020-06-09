
const gulp = require('gulp')
const webpack = require('webpack-stream');
const merge = require('webpack-merge');
const minimist = require('minimist');
const log = require('fancy-log');

// Files that will be copied to dist/ without any modifications
const AUX_FILES = ['package.json', 'README.md', 'LICENSE.txt'];

// Add all your configuration overrides for Webpack here
const sharedWebpackConfig = {
  mode: 'production',
  resolve: { extensions: ['.js', '.ts'] },
  module: {
    rules: [
      { test: /\.ts$/, exclude: /node_modules/, loader: "ts-loader", options: { transpileOnly: true } },
      { test: /\.m?js$/, exclude: /node_modules/, loader: 'babel-loader' },
    ]
  }
}

const args = minimist(process.argv.slice(2));

if (args.dev) {
  log.info(`Building in development mode.`);
  sharedWebpackConfig.mode = 'development';
  sharedWebpackConfig.devtool = 'source-map';
}

function copyAux() {
  return gulp.src(AUX_FILES)
    .pipe(gulp.dest('dist/'));
}

function bundle() {
  return gulp.src(['./src/index.ts', './src/script.ts'])
    .pipe(webpack({
      config: [
        merge(sharedWebpackConfig, {
          entry: './src/index.ts',
          target: 'node',
          output: { filename: 'index.js' },
        }),
        merge(sharedWebpackConfig, {
          entry: './src/register.ts',
          target: 'node',
          output: { filename: 'register.js' },
        }),
        merge(sharedWebpackConfig, {
          entry: './src/script.ts',
          target: 'web',
          output: { filename: 'script.js' },
        })
      ]
    }))
    .pipe(gulp.dest('dist/'));
}

const build = gulp.parallel(bundle, copyAux);

function startWatch() {
  return gulp.watch(
    ['src/**/*.ts', 'package.json', 'README.md', 'LICENSE.txt'],
    build,
  )
}

const watch = gulp.series(build, startWatch)

module.exports = {
  default: build,
  build,
  watch,
}

