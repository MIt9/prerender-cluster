    # Cluster Prerender

Lightweight Cluster Prerender container built on Alpine Linux with unlimited number of requests

## Requirements

- Docker

## Usage

Pull and run the image:

```
docker pull siniidrozd/prerender-cluster:1.1.0
docker run -p 3000:3000 siniidrozd/prerender-cluster:1.1.0
```
Prerender will now be running on http://localhost:3000. Try the container out with curl:

```
curl http://localhost:3000/render?url=https://www.example.com/
```

## Prerender memory cache

You can customize cache behavior with environment variables :
- CACHE_MAXSIZE=1000 : max number of objects in cache
- CACHE_TTL=6000 : time to live in seconds

```
docker run -p 3000:3000 -e CACHE_MAXSIZE=1000 -e CACHE_TTL=6000 siniidrozd/prerender-cluster:1.1.0
```

## Other params

- REQUEST_TIMEOUT=25000 : request timout 
- MONITOR=1 : parse monitor
- MAX_CONCURRENCY=4 : max instance count