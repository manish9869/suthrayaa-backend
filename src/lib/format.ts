import { getSettingSync } from "../modules/settings/settings.service.js";

/** Same exported signature as before settings existed — every existing call site is
 * untouched. Now reads currency/locale/decimals from site settings (falling back to the
 * catalog's India defaults, identical to the old hardcoded behavior, if unset/uncached). */
export function formatPrice(price: number): string {
  const currency = getSettingSync<string>("store.currency");
  const locale = getSettingSync<string>("store.locale");
  const decimals = Number(getSettingSync<string>("store.decimal_places"));

  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(price);
}
