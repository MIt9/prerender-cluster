const express = require('express');
const compression = require('compression');
const {Cluster} = require('puppeteer-cluster');
const cacheManager = require('cache-manager');
const memoryCache = cacheManager.caching({
    store: 'memory',
    max: +process.env.CACHE_MAXSIZE || 1000,
    ttl: +process.env.CACHE_TTL || 86400/*seconds*/
});

// Dont download all resources, we just need the HTML
// Also, this is huge performance/response time boost
const blockedResourceTypes = [
    'css',
    'image',
    'media',
    'font',
    'texttrack',
    'object',
    'beacon',
    'csp_report',
    'imageset',
];

const skippedResources = [
    'quantserve',
    'adzerk',
    'doubleclick',
    'adition',
    'exelator',
    'sharethrough',
    'cdn.api.twitter',
    'google-analytics',
    'googletagmanager',
    'google',
    'fontawesome',
    'facebook',
    'analytics',
    'optimizely',
    'clicktale',
    'mixpanel',
    'zedo',
    'clicksor',
    'tiqcdn',
    'adtelligent',
];

const render = async ({page, data: url}) => {
    try {
        await page.setRequestInterception(true);
        page.on('request', (request) => {
            const requestUrl = request.url().split('?')[0].split('#')[0];
            if (
                blockedResourceTypes.indexOf(request.resourceType()) !== -1 ||
                skippedResources.some(resource => requestUrl.indexOf(resource) !== -1)
            ) {
                return request.abort();
            }
            request.continue();
        });

        const response = await page.goto(url, {
            timeout: process.env.REQUEST_TIMEOUT || 25000,
            waitUntil: 'networkidle2'
        });

        // Inject <base> on page to relative resources load properly.
        await page.evaluate(link => {
            const base = document.createElement('base');
            base.href = (link || "").split("?").shift();
            // Add to top of head, before all other resources.
            document.head.prepend(base);
        }, url);

        // Remove scripts and html imports. They've already executed.
        await page.evaluate(() => {
            const scripts = document.querySelectorAll('script:not([type="application/ld+json"]), link[rel="import"]');
            const iframes = document.querySelectorAll('iframe');
            [...scripts, ...iframes].forEach(e => e.remove());
        });

        const html = await page.content();

        // Close the page we opened here (not the browser).
        // await page.close();
        return {html, status: response.status()}
    } catch (e) {
        const html = e.toString();
        console.warn({message: `URL: ${url} Failed with message: ${html}`})
        return {html, status: 500}
    }

}


const app = express();

(async () => {
    const cluster = await Cluster.launch({
        concurrency: Cluster.CONCURRENCY_CONTEXT,
        puppeteerOptions: {
            headless: true,
            ignoreHTTPSErrors: true,
            executablePath: process.env.CHROME_BIN || null,
            args: ['--no-sandbox', '--headless', '--disable-gpu', '--disable-dev-shm-usage']
        },
        monitor: process.env.MONITOR === "1" || false,
        maxConcurrency: +process.env.MAX_CONCURRENCY || 4,
    });
    const fetch = (url, cb) => {
        memoryCache.get(url, function (err, result) {
            if (err) {
                return cb(null, err);
            }
            const urlWithoutQuery = url.split("?").shift();
            const isLinkWithWithoutQuery = url.indexOf("?") === -1;

            if ( isLinkWithWithoutQuery && result) {
                return cb(null, result);
            }
            cluster.execute(urlWithoutQuery, render)
                .then(data => {
                    if (data.status === 200) {
                        memoryCache.set(urlWithoutQuery, data);
                    }
                    cb(null, data)
                })
        });
    }
    // this will compress all responses
    app.use(compression())

    app.use((req, res, next) => {
        res.header('Access-Control-Allow-Origin', '*');
        next();
    });

    app.get('/test', (req, res) => {
        return res.status(200).send('test')
    });

    app.get('/render', async (req, res) => {
        const {url} = req.query;

        if (!url) {
            return res.status(400).send('Invalid url param: Example: ?url=https:/silpo.ua');
        }

        console.time(`URL_START:${url}`)
        fetch(url, (err, {html, status}) => {
            console.timeEnd(`URL_START:${url}`)
            if (err) {
                res.status(500).send(err.message);
            } else {
                res.status(status).send(html);
            }
        })
    })

    app.listen(3000, function () {
        console.log('server listening on port 3000.');
    });
})();
