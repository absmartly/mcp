// Worker bundle stand-in for supports-color (aliased in wrangler.jsonc).
// @absmartly/cli's api-client imports its terminal formatter, which loads
// marked-terminal -> supports-hyperlinks. supports-hyperlinks calls
// supportsColor.supportsColor() at module load, but the bundler picks
// supports-color's browser.js, which has no such function, so the Worker threw
// at startup ("supportsColor2.supportsColor is not a function"; Cloudflare
// error 10021 on deploy). A Worker has no terminal: report no colour support.
'use strict';
module.exports = {
	supportsColor: () => false,
	stdout: false,
	stderr: false,
};
