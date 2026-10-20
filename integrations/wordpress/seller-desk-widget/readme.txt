=== Seller Desk Widget ===
Requires at least: 6.3
Tested up to: 7.0
Requires PHP: 8.0
Stable tag: 0.1.1
License: MIT

Add a self-hosted Seller Desk assistant without editing your WordPress theme.

== Installation ==
1. Start and configure a Seller Desk installation. Hosting and model usage are separate.
2. In WordPress, select Plugins > Add New Plugin > Upload Plugin. Choose seller-desk-widget.zip, install and activate it.
3. Open Settings > Seller Desk. Save your Seller Desk origin, for example https://desk.your-business.com.
4. In Seller Desk > Setup, add the exact website address shown by this plugin to Allowed websites.
5. Use Check storefront connection, then open the storefront and select Ask the shop.

Leave the address blank or deactivate the plugin to remove the widget. Clear any site/page/CDN cache after changing it. Your theme must call wp_footer().

== Scope and data ==
Only administrators with manage_options can configure this plugin. It uses WordPress settings and nonce checks. HTTPS is required, except HTTP loopback when WordPress also runs on loopback for local development.

The frontend loads /widget.js from the configured Seller Desk origin. The assistant runs in an isolated frame on that origin. Visitors send their conversation to that installation and its configured AI provider. The plugin does not request a PayPal or AI key, inspect customer accounts, read page content, or import orders. The browser shares its ordinary network information with the configured installation when loading it.

WooCommerce is optional. Public WooCommerce product lookup is configured separately in Seller Desk through WOO_STORE_URL. Existing shop checkout, shipping, taxes and orders remain in your shop. This plugin does not implement those integrations.

The connection check verifies the storefront allowlist, not AI availability, payment readiness, hosting reliability or compatibility with every browser/privacy configuration. Seller Desk software is free; hosting, model usage and payment fees can cost money.

== Development ==
Original plugin source is under integrations/wordpress/seller-desk-widget in the Seller Desk source. Rebuild the supplied ZIP with pnpm package:wordpress. No WordPress core or third-party plugin code is bundled.
