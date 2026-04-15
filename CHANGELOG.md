# Changelog

## [1.1.10](https://github.com/zot24/gh-issue-tracker/compare/v1.1.9...v1.1.10) (2026-04-15)


### Bug Fixes

* **ci:** clear NODE_AUTH_TOKEN to force OIDC provenance publish ([1af34fb](https://github.com/zot24/gh-issue-tracker/commit/1af34fbe7e4cdf4ef25ecbeb112e95ab687f0dc0))

## [1.1.9](https://github.com/zot24/gh-issue-tracker/compare/v1.1.8...v1.1.9) (2026-04-15)


### Bug Fixes

* **ci:** remove NODE_AUTH_TOKEN to use pure OIDC publish and rename CI workflow ([4ec95b0](https://github.com/zot24/gh-issue-tracker/commit/4ec95b0891795f42b4bd291e15eafabdd3cf45d0))

## [1.1.8](https://github.com/zot24/gh-issue-tracker/compare/v1.1.7...v1.1.8) (2026-04-15)


### Bug Fixes

* clarify flush() jsdoc for serverless usage ([8edd40d](https://github.com/zot24/gh-issue-tracker/commit/8edd40d2d1e67fe3d8c0e264e46387f849f86508))

## [1.1.7](https://github.com/zot24/gh-issue-tracker/compare/v1.1.6...v1.1.7) (2026-04-12)


### Bug Fixes

* **ci:** use granular NPM_TOKEN for automated publish ([#15](https://github.com/zot24/gh-issue-tracker/issues/15)) ([314ef26](https://github.com/zot24/gh-issue-tracker/commit/314ef26ce50461c3aa9551225517b697b1266979))

## [1.1.6](https://github.com/zot24/gh-issue-tracker/compare/v1.1.5...v1.1.6) (2026-04-12)


### Bug Fixes

* **ci:** use OIDC publish without NODE_AUTH_TOKEN ([#13](https://github.com/zot24/gh-issue-tracker/issues/13)) ([6923fbb](https://github.com/zot24/gh-issue-tracker/commit/6923fbb5d15f92372fac819a93b33e6570d8b936))

## [1.1.5](https://github.com/zot24/gh-issue-tracker/compare/v1.1.4...v1.1.5) (2026-04-12)


### Bug Fixes

* **ci:** remove registry-url to let npm OIDC authenticate natively ([#11](https://github.com/zot24/gh-issue-tracker/issues/11)) ([6a8ed6b](https://github.com/zot24/gh-issue-tracker/commit/6a8ed6b94949e2fa3714dede2fe041c088e7f9ca))

## [1.1.4](https://github.com/zot24/gh-issue-tracker/compare/v1.1.3...v1.1.4) (2026-04-12)


### Documentation

* reframe security guidance with two-path approach ([#9](https://github.com/zot24/gh-issue-tracker/issues/9)) ([c05f8f6](https://github.com/zot24/gh-issue-tracker/commit/c05f8f64998d031549c71ac9b378fbd2e98b3067))

## [1.1.3](https://github.com/zot24/gh-issue-tracker/compare/v1.1.2...v1.1.3) (2026-04-12)


### Bug Fixes

* normalize repository URL in package.json ([83dced3](https://github.com/zot24/gh-issue-tracker/commit/83dced323fbaeb81f35b7b03febdb845d70b58fd))

## [1.1.2](https://github.com/zot24/gh-issue-tracker/compare/v1.1.1...v1.1.2) (2026-04-12)


### Maintenance

* **ci:** switch npm publish to OIDC trusted publishers ([#6](https://github.com/zot24/gh-issue-tracker/issues/6)) ([d33088f](https://github.com/zot24/gh-issue-tracker/commit/d33088f87eb991a3bd0a4646e5236487a67695dc))

## [1.1.1](https://github.com/zot24/gh-issue-tracker/compare/v1.1.0...v1.1.1) (2026-04-12)


### Bug Fixes

* **ci:** use correct release-please output keys for single-package repo ([#4](https://github.com/zot24/gh-issue-tracker/issues/4)) ([3b2aa3f](https://github.com/zot24/gh-issue-tracker/commit/3b2aa3f744e7c9f57916366f5bfd79cdacb36231))

## [1.1.0](https://github.com/zot24/gh-issue-tracker/compare/v1.0.0...v1.1.0) (2026-04-12)


### Features

* add deployable error proxies and security documentation ([25c3e34](https://github.com/zot24/gh-issue-tracker/commit/25c3e3441eb9e8c136796a5c9c2e627c02085e5c))
* initial release — GitHub Issues error tracker ([3dc3808](https://github.com/zot24/gh-issue-tracker/commit/3dc38089b32a597970dadea21a933d644d90eabb))


### Bug Fixes

* **ci:** require Node.js &gt;= 20 (Vitest 4 + Rolldown need styleText) ([#2](https://github.com/zot24/gh-issue-tracker/issues/2)) ([3e711f8](https://github.com/zot24/gh-issue-tracker/commit/3e711f8ba793d46ef12ea3f0daeb52bc6f8f3cb9))


### Documentation

* add .env.example files and Vercel deploy button ([#1](https://github.com/zot24/gh-issue-tracker/issues/1)) ([f4bed7c](https://github.com/zot24/gh-issue-tracker/commit/f4bed7c05d747cb873cb5eb4377ea73f765530b9))


### Maintenance

* add release-please for automated versioning and npm publish ([e1b1f7f](https://github.com/zot24/gh-issue-tracker/commit/e1b1f7f7cd6015ecff265387eda3bbf07d150f77))
