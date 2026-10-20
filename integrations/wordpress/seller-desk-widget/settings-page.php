<?php
/** Original settings view. WordPress Settings API owns all configuration writes. */
namespace SellerDesk\Widget;
defined('ABSPATH') || exit;
?>
<div class="wrap sd-settings">
  <header class="sd-heading">
    <div><h1><?php esc_html_e('Your shop assistant', 'seller-desk-widget'); ?></h1>
      <p><?php esc_html_e('Help customers find the right product, right on your website.', 'seller-desk-widget'); ?></p></div>
    <span id="seller-desk-connection-state" class="sd-status" data-state="idle"><?php echo esc_html($origin === '' ? __('Not connected', 'seller-desk-widget') : __('Ready to check', 'seller-desk-widget')); ?></span>
  </header>
  <div class="sd-layout">
    <div class="sd-panel">
      <section class="sd-step" aria-labelledby="sd-connect-heading">
        <span class="sd-step-number" aria-hidden="true">1</span>
        <div class="sd-step-content">
          <h2 id="sd-connect-heading"><?php esc_html_e('Connect Seller Desk', 'seller-desk-widget'); ?></h2>
          <p><?php esc_html_e('Copy your address from Seller Desk → Install, then paste it here.', 'seller-desk-widget'); ?></p>
          <form method="post" action="<?php echo esc_url(admin_url('options.php')); ?>">
            <?php settings_fields(GROUP); ?>
            <label for="seller-desk-origin"><?php esc_html_e('Seller Desk address', 'seller-desk-widget'); ?></label>
            <input id="seller-desk-origin" name="<?php echo esc_attr(OPTION); ?>" type="url" maxlength="255" value="<?php echo esc_attr($origin); ?>" placeholder="https://desk.your-business.com" aria-describedby="seller-desk-address-help" autocomplete="off" spellcheck="false">
            <p class="sd-help" id="seller-desk-address-help"><?php esc_html_e('Use the main address, without /buy or /widget. Never enter a password or API key.', 'seller-desk-widget'); ?></p>
            <?php submit_button(__('Save address', 'seller-desk-widget')); ?>
          </form>
        </div>
      </section>
      <section class="sd-step" aria-labelledby="sd-allow-heading">
        <span class="sd-step-number" aria-hidden="true">2</span>
        <div class="sd-step-content">
          <h2 id="sd-allow-heading"><?php esc_html_e('Allow this website', 'seller-desk-widget'); ?></h2>
          <p><?php esc_html_e('Add this address to Allowed websites in Seller Desk Setup.', 'seller-desk-widget'); ?></p>
          <div class="sd-copy"><code id="seller-desk-site-address"><?php echo esc_html($site_origin); ?></code><button type="button" class="button" id="seller-desk-copy"><?php esc_html_e('Copy address', 'seller-desk-widget'); ?></button></div>
          <p class="sd-help" id="seller-desk-copy-result" role="status"></p>
          <?php if ($origin !== '') : ?>
            <a class="sd-link" href="<?php echo esc_url($origin . '/owner/setup#widget'); ?>" target="_blank" rel="noopener noreferrer"><?php esc_html_e('Open Seller Desk setup', 'seller-desk-widget'); ?> <span aria-hidden="true">↗</span><span class="screen-reader-text"><?php esc_html_e(' (opens in a new tab)', 'seller-desk-widget'); ?></span></a>
          <?php endif; ?>
        </div>
      </section>
      <section class="sd-step" aria-labelledby="sd-test-heading">
        <span class="sd-step-number" aria-hidden="true">3</span>
        <div class="sd-step-content">
          <h2 id="sd-test-heading"><?php esc_html_e('Check, then try it', 'seller-desk-widget'); ?></h2>
          <p><?php esc_html_e('Check this connection. Then open your website and look for Ask the shop.', 'seller-desk-widget'); ?></p>
          <div class="sd-actions"><button type="button" class="button button-primary" id="seller-desk-check" data-desk-origin="<?php echo esc_attr($origin); ?>" <?php disabled($origin, ''); ?>><?php esc_html_e('Check connection', 'seller-desk-widget'); ?></button>
            <a class="button" href="<?php echo esc_url(home_url('/')); ?>"><?php esc_html_e('Open my website', 'seller-desk-widget'); ?></a></div>
          <p class="sd-result" id="seller-desk-check-result" role="status" aria-live="polite" data-state="idle"><?php echo esc_html($origin === '' ? __('Save your Seller Desk address to get started.', 'seller-desk-widget') : __('Your address is saved. Run a check to test this connection.', 'seller-desk-widget')); ?></p>
        </div>
      </section>
    </div>
    <aside class="sd-aside" aria-label="Setup help">
      <h2><?php esc_html_e('Your shop. A little more helpful.', 'seller-desk-widget'); ?></h2>
      <p><?php esc_html_e('Customers get a place to ask about your products. When an answer needs you, Seller Desk brings you the question.', 'seller-desk-widget'); ?></p>
      <hr>
      <h3><?php esc_html_e('Already use WooCommerce?', 'seller-desk-widget'); ?></h3>
      <p><?php esc_html_e('Connect your public catalog in Seller Desk. Customers choose options and pay in your existing shop.', 'seller-desk-widget'); ?></p>
      <h3><?php esc_html_e('Before you start', 'seller-desk-widget'); ?></h3>
      <p><?php esc_html_e('You need a running Seller Desk with AI configured. The plugin is free; your hosting and AI provider may charge.', 'seller-desk-widget'); ?></p>
    </aside>
  </div>
  <details class="sd-details"><summary><?php esc_html_e('Connection details & removing the assistant', 'seller-desk-widget'); ?></summary>
    <p><?php esc_html_e('The connection check only confirms that this website can open the widget. Test an actual conversation and your checkout separately.', 'seller-desk-widget'); ?></p>
    <p><?php esc_html_e('This plugin loads Seller Desk on public pages. Visitor conversations go to your Seller Desk and configured AI provider. It does not read WordPress customer accounts or copy WooCommerce orders.', 'seller-desk-widget'); ?></p>
    <p><?php esc_html_e('To remove the assistant, clear the Seller Desk address and save. Your shop and its orders stay in place.', 'seller-desk-widget'); ?></p>
  </details>
</div>
