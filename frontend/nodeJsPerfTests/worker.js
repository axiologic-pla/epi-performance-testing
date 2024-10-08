const http = require('http');
const https = require('https');
const url = require('url');

// Function to format bytes to kilobytes (kB)
const bytesToKB = (bytes) => (bytes / 1024).toFixed(2);

// Send a GET request and collect metrics

function collectMetrics(requestUrl, id) {
    return new Promise((resolve, reject) => {
        const parsedUrl = url.parse(requestUrl);
        const isHttps = parsedUrl.protocol === 'https:';
        const httpLib = isHttps ? https : http;

        const requestMetrics = {
            id: null, // This will be set when the parent sends a message
            dnsLookupTime: null,
            tcpHandshakeTime: null,
            sslHandshakeTime: isHttps ? null : 'N/A',
            webServerTime: null, // Web server processing time (Time to first byte - connection times)
            sizeTransferredKB: 0,
            timeToFirstByte: null,
            dataTransferTime: null,
            totalTime: null,
            httpStatusCode: null
        };

        const start = process.hrtime();
        let totalDataSize = 0;

        console.log(`Making the request for ${requestUrl}`);

        const req = httpLib.get(requestUrl, (res) => {
            const responseStart = process.hrtime(start);
            requestMetrics.timeToFirstByte = responseStart[0] * 1000 + responseStart[1] / 1e6; // Convert to ms

            res.on('data', (chunk) => {
                totalDataSize += chunk.length; // Accumulate transferred size
            });

            res.on('end', () => {
                requestMetrics.httpStatusCode = res.statusCode;
                const totalTime = process.hrtime(start);
                requestMetrics.totalTime = totalTime[0] * 1000 + totalTime[1] / 1e6; // Convert to ms
                requestMetrics.dataTransferTime = requestMetrics.totalTime - requestMetrics.timeToFirstByte; // Data transfer time
                requestMetrics.sizeTransferredKB = bytesToKB(totalDataSize);

                // Web server time is how long it took the server to start sending a response after the connection
                requestMetrics.webServerTime = requestMetrics.timeToFirstByte - (requestMetrics.tcpHandshakeTime + (isHttps ? requestMetrics.sslHandshakeTime : 0));

                resolve(requestMetrics); // Send the metrics to the parent
            });
        });

        req.on('socket', (socket) => {
            // DNS lookup time
            socket.on('lookup', () => {
                const dnsLookupTime = process.hrtime(start);
                requestMetrics.dnsLookupTime = dnsLookupTime[0] * 1000 + dnsLookupTime[1] / 1e6; // Convert to ms
            });

            // TCP handshake time
            socket.on('connect', () => {

                const tcpHandshakeTime = process.hrtime(start);
                //console.log('Connected', id);
                requestMetrics.tcpHandshakeTime = tcpHandshakeTime[0] * 1000 + tcpHandshakeTime[1] / 1e6; // Convert to ms
            });

            // SSL handshake time (only for HTTPS)
            if (isHttps) {
                socket.on('secureConnect', () => {
                    //console.log('secureConnect', id);
                    const sslHandshakeTime = process.hrtime(start);
                    requestMetrics.sslHandshakeTime = sslHandshakeTime[0] * 1000 + sslHandshakeTime[1] / 1e6; // Convert to ms
                });
            }
        });

        req.on('error', (err) => {
            reject(err);
        });
    });
}
// Handle messages from the parent process
process.on('message', async (message) => {
    const requestUrl = message.url; // Change to the target URL

    try {
        const metrics = await collectMetrics(requestUrl, message.id);
        metrics.id = message.id; // Include the request id
        process.send(metrics); // Send the metrics back to the parent process
    } catch (error) {
        console.error('Request error:', error);
        process.exit(1);
    }
});
