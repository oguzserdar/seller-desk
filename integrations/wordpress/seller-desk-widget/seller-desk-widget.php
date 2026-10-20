<?php
/**
 * Plugin Name: Seller Desk Widget
 * Description: Add your self-hosted Seller Desk assistant without editing your theme.
 * Version: 0.1.1
 * Requires at least: 6.3
 * Requires PHP: 8.0
 * License: MIT
 * Text Domain: seller-desk-widget
 */
namespace SellerDesk\Widget;

defined('ABSPATH') || exit;

const OPTION = 'seller_desk_widget_origin';
const GROUP = 'seller_desk_widget';

/** Accept one origin, with HTTP allowed only between local development sites. */
function normalize_origin($value): ?string {
    if (!is_string($value)) return null;
    $value = trim($value);
    if ($value === '') return '';
    if (strlen($value) > 255 || !preg_match('~\A(https?)://(\[::1\]|[a-z0-9.-]+)(?::([0-9]{1,5}))?/?\z~iD', $value, $parts)) return null;
    $scheme = strtolower($parts[1]);
    $host = strtolower($parts[2]);
    $locals = array('localhost', '127.0.0.1', '[::1]');
    $local = in_array($host, $locals, true);
    if (!$local && !filter_var($host, FILTER_VALIDATE_DOMAIN, FILTER_FLAG_HOSTNAME)) return null;
    $site_host = strtolower((string) wp_parse_url(home_url('/'), PHP_URL_HOST));
    if ($scheme === 'http' && (!$local || !in_array($site_host, $locals, true))) return null;
    $port = isset($parts[3]) ? (int) $parts[3] : null;
    if ($port !== null && ($port < 1 || $port > 65535)) return null;
    $suffix = $port !== null && !(($scheme === 'https' && $port === 443) || ($scheme === 'http' && $port === 80)) ? ':' . $port : '';
    return $scheme . '://' . $host . $suffix;
}

/** Validate stored values on reads too; invalid configuration never loads a script. */
function desk_origin(): string {
    return normalize_origin(get_option(OPTION, '')) ?? '';
}

/** Invalid edits keep the last valid setting and show a visible WordPress error. */
function sanitize_origin($value): string {
    $origin = normalize_origin($value);
    if ($origin !== null) return $origin;
    add_settings_error(OPTION, 'invalid_origin', __('Enter your Seller Desk HTTPS address only, without a page path, login, query or fragment. HTTP is allowed only for local development.', 'seller-desk-widget'));
    return desk_origin();
}

/** WordPress options.php owns capability and nonce checks for this setting. */
function register_settings(): void {
    register_setting(GROUP, OPTION, array('type' => 'string', 'default' => '', 'show_in_rest' => false, 'sanitize_callback' => __NAMESPACE__ . '\\sanitize_origin'));
}
add_action('admin_init', __NAMESPACE__ . '\\register_settings');

/** Keep configuration in the native WordPress Settings menu. */
function register_page(): void {
    add_options_page('Seller Desk', 'Seller Desk', 'manage_options', 'seller-desk-widget', __NAMESPACE__ . '\\settings_page');
}
add_action('admin_menu', __NAMESPACE__ . '\\register_page');

/** Enqueue the existing isolated widget only on public frontend pages. */
function enqueue_widget(): void {
    $origin = desk_origin();
    if ($origin === '' || is_admin() || is_feed() || is_embed()) return;
    wp_enqueue_script('seller-desk-widget', $origin . '/widget.js', array(), null, array('strategy' => 'async', 'in_footer' => true));
}
add_action('wp_enqueue_scripts', __NAMESPACE__ . '\\enqueue_widget');

/** The settings check runs our local script, never the remote widget in wp-admin. */
function enqueue_settings($hook): void {
    if ($hook !== 'settings_page_seller-desk-widget' || !current_user_can('manage_options')) return;
    wp_enqueue_style('seller-desk-widget-settings', plugins_url('settings.css', __FILE__), array(), '0.1.1');
    wp_enqueue_script('seller-desk-widget-settings', plugins_url('settings.js', __FILE__), array(), '0.1.1', array('strategy' => 'defer', 'in_footer' => true));
}
add_action('admin_enqueue_scripts', __NAMESPACE__ . '\\enqueue_settings');

/** Explain both ends of the connection without implying that hosting is included. */
function settings_page(): void {
    if (!current_user_can('manage_options')) wp_die(esc_html__('You cannot manage this setting.', 'seller-desk-widget'), '', array('response' => 403));
    $origin = desk_origin();
    $site = wp_parse_url(home_url('/'));
    $site_origin = ($site['scheme'] ?? 'https') . '://' . ($site['host'] ?? '') . (isset($site['port']) ? ':' . $site['port'] : '');
    require __DIR__ . '/settings-page.php';
}
