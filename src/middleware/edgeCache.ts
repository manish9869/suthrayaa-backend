import type { NextFunction, Request, Response } from "express";

/**
 * Lets Vercel's CDN serve public, non-personalised GETs (catalog, content, settings) for
 * `sMaxAge` seconds and then refresh in the background — a traffic spike becomes a handful
 * of origin requests instead of one database round-trip per shopper. Only successful
 * responses to requests without credentials are marked cacheable.
 */
export function edgeCache(sMaxAge = 60, staleWhileRevalidate = 300) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== "GET" || req.headers.authorization) return next();
    const json = res.json.bind(res);
    res.json = (body) => {
      if (res.statusCode < 400 && !res.getHeader("Cache-Control")) {
        res.setHeader("Cache-Control", `public, max-age=0, s-maxage=${sMaxAge}, stale-while-revalidate=${staleWhileRevalidate}`);
      }
      return json(body);
    };
    next();
  };
}
