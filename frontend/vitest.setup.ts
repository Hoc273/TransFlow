// Vitest does not force NODE_ENV. A shell-level NODE_ENV=production loads the
// React production build, which does not export React.act — @testing-library/react
// then falls back to react-dom/test-utils.act, which calls React.act and throws
// "React.act is not a function". Force a non-production build for the test runtime.
process.env.NODE_ENV = 'test'
