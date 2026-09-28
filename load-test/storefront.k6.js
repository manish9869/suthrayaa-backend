// Storefront load test (https://k6.io). Simulates shoppers browsing: home → shop → product,
// plus the public API calls the browser makes. Read-only — it never places orders or payments.
//
//   k6 run -e SITE=https://your-site.vercel.app -e API=https://your-api.vercel.app/api load-test/storefront.k6.js
//   k6 run -e PEAK=5000 ...            # raise the peak virtual users (one laptop tops out ~2-5k;
//                                      # for 1 lakh use `k6 cloud` / Grafana Cloud k6)
//
// Run it against a preview/staging deployment first, and tell Vercel + Supabase support
// before a very large run so it isn't mistaken for an attack.
import http from 'k6/http'
import { check, sleep } from 'k6'

const SITE = __ENV.SITE
const API = __ENV.API
const PEAK = Number(__ENV.PEAK || 1000)

export const options = {
  stages: [
    { duration: '1m', target: Math.round(PEAK / 4) },
    { duration: '3m', target: PEAK },
    { duration: '5m', target: PEAK },
    { duration: '1m', target: 0 },
  ],
  thresholds: {
    http_req_failed: ['rate<0.01'], // <1% errors
    http_req_duration: ['p(95)<1500'], // 95% of requests under 1.5s
  },
}

export function setup() {
  if (!SITE || !API) throw new Error('Pass -e SITE=<storefront url> -e API=<api base url ending in /api>')
  const res = http.get(`${API}/products?limit=24`)
  const body = res.json()
  const items = Array.isArray(body) ? body : body.items ?? body.products ?? body.data ?? []
  return { slugs: items.map((p) => p.slug).filter(Boolean) }
}

export default function ({ slugs }) {
  const ok = (res, name) => check(res, { [`${name} 200`]: (r) => r.status === 200 })

  ok(http.get(`${SITE}/`), 'home')
  http.batch([
    ['GET', `${API}/content`],
    ['GET', `${API}/site-settings/public`],
    ['GET', `${API}/categories`],
  ]).forEach((r) => ok(r, 'api'))
  sleep(2 + Math.random() * 3)

  ok(http.get(`${SITE}/shop`), 'shop')
  ok(http.get(`${API}/products`), 'products api')
  sleep(2 + Math.random() * 3)

  if (slugs.length) {
    const slug = slugs[Math.floor(Math.random() * slugs.length)]
    ok(http.get(`${SITE}/product/${slug}`), 'product page')
    ok(http.get(`${API}/products/${slug}`), 'product api')
  }
  sleep(3 + Math.random() * 5)
}
