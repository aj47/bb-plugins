// The voice core ships bundler-style ESM (extensionless imports); let vite
// transform it the way bb's plugin bundler does.
export default { test: { globals: true, server: { deps: { inline: ["@aj47/bb-voice-core"] } } } };
