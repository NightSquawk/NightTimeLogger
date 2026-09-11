/**
 * @file /tests/helpers/dockerAvailable.js
 * @description Synchronous detection of a reachable Docker daemon. Used to gate
 *              testcontainers-based integration tests so they skip cleanly in
 *              sandboxes/CI runners without Docker.
 */

const fs = require('fs');

const candidatePaths = [
    '/var/run/docker.sock',
    process.env.DOCKER_HOST && process.env.DOCKER_HOST.replace(/^unix:\/\//, ''),
].filter(Boolean);

function dockerAvailable() {
    if (process.env.SKIP_DOCKER_TESTS === '1') return false;
    for (const p of candidatePaths) {
        try {
            if (fs.existsSync(p)) return true;
        } catch {
            // ignore
        }
    }
    // TCP DOCKER_HOST (tcp://...) is assumed available; testcontainers will fail loudly if not
    if (process.env.DOCKER_HOST && /^tcp:\/\//.test(process.env.DOCKER_HOST)) return true;
    return false;
}

const available = dockerAvailable();
if (process.env.REQUIRE_DOCKER_TESTS === '1' && !available) throw new Error('Docker integration tests are required but Docker is unavailable');
const describeIfDocker = available ? describe : describe.skip;

module.exports = { dockerAvailable, describeIfDocker };
