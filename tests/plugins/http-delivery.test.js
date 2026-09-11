const http = require('http');
const { HttpDelivery } = require('../../plugins/lib/httpDelivery');
const OpenObserve = require('../../plugins/openobserve').transport;
const Teams = require('../../plugins/teams').transport;
const Discord = require('../../plugins/discord').transport;

let server;
let url;
async function serve(handler) {
    server = http.createServer(handler);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${server.address().port}`;
}
afterEach(async () => {
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); server = null; }
});

test('OpenObserve flush waits for response and preserves event timestamps', async () => {
    let body = '';
    let received;
    const requestArrived = new Promise(resolve => { received = resolve; });
    await serve((req, res) => {
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => received(res));
    });
    const transport = new OpenObserve({ host: url, organization: 'org', stream: 'logs', username: 'u', password: 'p', maxRetries: 0 });
    transport.log({ level: 'info', message: 'hello', timestamp: '2026-09-10T00:00:00.000Z' }, () => {});
    let completed = false;
    const flushing = transport.flush().then(() => { completed = true; });
    const response = await requestArrived;
    expect(completed).toBe(false);
    response.end('ok');
    await flushing;
    expect(JSON.parse(body)[0].timestamp).toBe('2026-09-10T00:00:00.000Z');
    await transport.close();
});

test.each([Teams, Discord])('%p handles status 429 retries and delivers before callback', async Class => {
    let requests = 0;
    await serve((req, res) => { requests++; res.statusCode = requests === 1 ? 429 : 200; res.setHeader('Retry-After', '0'); res.end(); });
    const transport = new Class({ webhookUrl: url, retryDelay: 1, maxRetries: 1 });
    await new Promise((resolve, reject) => transport.log({ level: 'info', message: 'test' }, error => error ? reject(error) : resolve()));
    expect(requests).toBe(2);
    await transport.close();
});

test('non-retryable failures reject callbacks and flush', async () => {
    await serve((req, res) => { res.statusCode = 400; res.end(); });
    const transport = new Discord({ webhookUrl: url, maxRetries: 0 });
    await expect(new Promise((resolve, reject) => transport.log({ level: 'info', message: 'test' }, error => error ? reject(error) : resolve()))).rejects.toThrow('400');
    await expect(transport.flush()).rejects.toThrow('400');
    await transport.close();
});

test('OpenObserve reports retry exhaustion through flush', async () => {
    let count = 0;
    await serve((req, res) => { count++; res.statusCode = 500; res.end(); });
    const transport = new OpenObserve({ host: url, organization: 'org', stream: 'logs', username: 'u', password: 'p', retryDelay: 1, maxRetries: 1 });
    transport.log({ level: 'info', message: 'test' }, () => {});
    await expect(transport.flush()).rejects.toThrow('500');
    expect(count).toBe(2);
    await transport.close();
});

test('request timeout bounds a nonresponsive server and queue overflow is observable', async () => {
    await serve(() => {});
    const delivery = new HttpDelivery(url, { timeout: 30, maxRetries: 0, maxPending: 1 });
    const pending = delivery.send('{}');
    await expect(delivery.send('{}')).rejects.toThrow('queue is full');
    await expect(pending).rejects.toThrow('timed out');
    await expect(delivery.flush()).rejects.toThrow();
});
