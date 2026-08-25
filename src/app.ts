import express from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import { pinoHttp } from "pino-http";

import { env } from "./config/env.js";
import { supabaseAdmin } from "./config/supabase.js";
import { logger } from "./lib/logger.js";
import { generalLimiter } from "./middleware/rateLimiter.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";

import { webhooksRouter } from "./modules/webhooks/webhooks.routes.js";

import { categoriesRouter } from "./modules/catalog/categories.routes.js";
import { productsRouter } from "./modules/catalog/products.routes.js";
import { colorsRouter } from "./modules/catalog/colors.routes.js";
import { testimonialsRouter } from "./modules/catalog/testimonials.routes.js";
import { heroSlidesRouter } from "./modules/catalog/heroSlides.routes.js";
import { reviewsRouter } from "./modules/catalog/reviews.routes.js";

import { meRouter } from "./modules/customers/me.routes.js";
import { checkoutRouter } from "./modules/checkout/checkout.routes.js";
import { couponsRouter } from "./modules/coupons/coupons.routes.js";
import { contactRouter } from "./modules/contact/contact.routes.js";

import { adminMeRouter } from "./modules/admin/admin.me.routes.js";
import { adminInvitesRouter } from "./modules/admin/admin.invites.routes.js";
import { adminUsersRouter } from "./modules/admin/admin.users.routes.js";
import { adminRolesRouter, adminPermissionsRouter } from "./modules/admin/admin.roles.routes.js";
import { adminAuditLogsRouter } from "./modules/admin/admin.auditLogs.routes.js";
import { adminProductsRouter } from "./modules/admin/admin.products.routes.js";
import {
  adminCategoriesRouter,
  adminColorsRouter,
  adminTestimonialsRouter,
  adminHeroSlidesRouter,
} from "./modules/admin/admin.catalogMeta.routes.js";
import { adminOrdersRouter } from "./modules/admin/admin.orders.routes.js";
import { adminCouponsRouter } from "./modules/admin/admin.coupons.routes.js";
import { adminCustomersRouter } from "./modules/admin/admin.customers.routes.js";
import { adminReviewsRouter } from "./modules/admin/admin.reviews.routes.js";
import { adminCustomizationTemplatesRouter } from "./modules/admin/admin.customizationTemplates.routes.js";
import { adminEmailTemplatesRouter, adminEmailLogsRouter } from "./modules/admin/admin.emails.routes.js";
import { adminInvoiceSettingsRouter } from "./modules/admin/admin.settings.routes.js";
import { adminSiteSettingsRouter } from "./modules/admin/admin.siteSettings.routes.js";
import { analyticsRouter } from "./modules/analytics/analytics.routes.js";
import {
  publicSettingsRouter,
  publicNavRouter,
  publicFooterRouter,
  publicHomepageSectionsRouter,
} from "./modules/settings/publicSettings.routes.js";

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(cors({ origin: env.FRONTEND_URL }));
  app.use(compression());
  app.use(pinoHttp({ logger }));
  app.use(generalLimiter);

  // Mounted before the global JSON parser: the Razorpay webhook needs the raw request
  // body to verify its HMAC signature.
  app.use("/api/webhooks", webhooksRouter);

  app.use(express.json({ limit: "2mb" }));
  app.use(express.urlencoded({ extended: true }));

  // Public, unauthenticated by design — see admin.invites.routes.ts. Mounted before every
  // other /api/admin/* router, none of which allow unauthenticated access.
  app.use("/api/admin/invites", adminInvitesRouter);

  app.get("/api/health", async (_req, res) => {
    const { data, error } = await supabaseAdmin.from("categories").select("id").limit(1);
    res.json({
      ok: true,
      env: env.NODE_ENV,
      database:
        error || !data ? { connected: false, hint: error?.message ?? "unknown" } : { connected: true },
    });
  });

  // Public catalog
  app.use("/api/categories", categoriesRouter);
  app.use("/api/products", productsRouter);
  app.use("/api/colors", colorsRouter);
  app.use("/api/testimonials", testimonialsRouter);
  app.use("/api/hero-slides", heroSlidesRouter);
  app.use("/api/reviews", reviewsRouter);

  // Public site settings — unauthenticated, filtered to isPublic-only keys in settings.service.
  app.use("/api/site-settings/public", publicSettingsRouter);
  app.use("/api/nav-items", publicNavRouter);
  app.use("/api/footer-links", publicFooterRouter);
  app.use("/api/homepage-sections", publicHomepageSectionsRouter);

  // Customer-facing
  app.use("/api/me", meRouter);
  app.use("/api/checkout", checkoutRouter);
  app.use("/api/coupons", couponsRouter);
  app.use("/api/contact", contactRouter);

  // Admin — every router here applies its own authenticate + requireAdmin internally.
  app.use("/api/admin", adminMeRouter);
  app.use("/api/admin/products", adminProductsRouter);
  app.use("/api/admin/categories", adminCategoriesRouter);
  app.use("/api/admin/colors", adminColorsRouter);
  app.use("/api/admin/testimonials", adminTestimonialsRouter);
  app.use("/api/admin/hero-slides", adminHeroSlidesRouter);
  app.use("/api/admin/orders", adminOrdersRouter);
  app.use("/api/admin/coupons", adminCouponsRouter);
  app.use("/api/admin/customers", adminCustomersRouter);
  app.use("/api/admin/reviews", adminReviewsRouter);
  app.use("/api/admin/customization-templates", adminCustomizationTemplatesRouter);
  app.use("/api/admin/emails/templates", adminEmailTemplatesRouter);
  app.use("/api/admin/emails/logs", adminEmailLogsRouter);
  app.use("/api/admin/settings/invoice", adminInvoiceSettingsRouter);
  app.use("/api/admin/settings", adminSiteSettingsRouter);
  app.use("/api/admin/analytics", analyticsRouter);
  app.use("/api/admin/users", adminUsersRouter);
  app.use("/api/admin/roles", adminRolesRouter);
  app.use("/api/admin/permissions", adminPermissionsRouter);
  app.use("/api/admin/audit-logs", adminAuditLogsRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
