const express = require('express');
const compression = require('compression');
const axios = require('axios');
const {Cluster} = require('puppeteer-cluster');
const cacheManager = require('cache-manager');
const SitemapXMLParser = require('sitemap-xml-parser');
const memoryCache = cacheManager.caching({
    store: 'memory',
    max: +process.env.CACHE_MAXSIZE || 1000,
    ttl: +process.env.CACHE_TTL || 86400/*seconds*/
});

const MAP_PARSER_OPTIONS = {
    delay: 3000,
    limit: 5
};

const app = express();

// Don't download all resources, we just need the HTML
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
        //collect style links
        const styleHrefs = await page.$$eval('link[rel=stylesheet]', els => Array.from(els).map(s => s.href));

        let css = "";
        await Promise.all(styleHrefs.map(async href => {
            try {
                let {data} = await axios.get(href);
                css += data;
            } catch (e) {
                console.log("error with => ", href)
            }
        }));

        await page.evaluate(async (styleCss) => {
            // Remove stylesheet link
            const style = document.querySelectorAll('link[rel="stylesheet"]');
            // Remove scripts and html imports. They've already executed.
            const scripts = document.querySelectorAll('script:not([type="application/ld+json"]), link[rel="import"]');
            const iframes = document.querySelectorAll('iframe');
            const preload = document.querySelectorAll('link[rel="preload"]');
            [...scripts, ...iframes, ...style, ...preload].forEach(e => e.remove());
            //inject all css in one style tag
            const head = document.head;
            const styleTag = document.createElement('style');
            styleTag.appendChild(document.createTextNode(styleCss));
            head.appendChild(styleTag);
        }, css);

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
                return cb(err);
            }
            const urlWithoutQuery = url.split("?").shift();
            const isLinkWithWithoutQuery = url.indexOf("?") === -1;

            if (isLinkWithWithoutQuery && result) {
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

    app.use((_req, res, next) => {
        res.header('Access-Control-Allow-Origin', '*');
        next();
    });

    app.get('/test', (_req, res) => {
        return res.status(200).send('test')
    });
    app.get('/map-render', async (req, res) => {
        const {url, version} = req.query;

        if (!url) {
            return res.status(400).send('Invalid url param: Example: ?url=https://example.com/sitemap.xml&version=3.0.0');
        }
        const sitemapXMLParser = new SitemapXMLParser(url, MAP_PARSER_OPTIONS);
        const v = version || +(new Date());
        sitemapXMLParser.fetch().then(result => {
            res.status(200).send("The sitemap now in queue, number of urls to ad is " + result.length);
            for (const {loc} of result) {
                if (loc[0]) {
                    fetch(loc[0] + "?v=" + v, (err) => {
                        if (err) {
                            console.log(`cluster cash FAILED with url ${loc[0]}`);
                            console.error(err);
                        } else {
                            console.log(`cluster cash updated with url ${loc[0]}`);
                        }
                    })
                }
            }
        })
            .catch(err => {
                res.status(500).send(err?.message);
            });

    })
    app.get('/render', async (req, res) => {
        const {url} = req.query;

        if (!url) {
            return res.status(400).send('Invalid url param: Example: ?url=https://example.com');
        }

        console.time(`URL_START:${url}`)
        fetch(url, (err, item) => {
            console.timeEnd(`URL_START:${url}`)
            if (err) {
                res.status(500).send(err.message);
            } else {
                const {html, status} = item;
                res.status(status).send(html);
            }
        })
    })

    app.listen(3000, function () {
        console.log('server listening on port 3000.');
    });
})();
