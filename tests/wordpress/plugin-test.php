<?php
/** Standalone PHP controls for plugin URL validation and frontend/admin isolation.
 * Run: php tests/wordpress/plugin-test.php
 * WordPress functions below are test doubles; real settings/nonce checks are separate browser/API evidence.
 */
define('ABSPATH', '/test/');
$site = 'https://shop.example';
$option = '';
$can_manage = false;
$admin = $feed = $embed = false;
$scripts = $styles = $settings = $errors = array();
function home_url($path) { return $GLOBALS['site'] . $path; }
function wp_parse_url($url, $component = -1) { return parse_url($url, $component); }
function get_option($key, $default = '') { return $GLOBALS['option']; }
function add_action(...$args) {}
function add_settings_error(...$args) { $GLOBALS['errors'][] = $args; }
function __($value, $domain) { return $value; }
function esc_html__($value, $domain) { return htmlspecialchars($value); }
function register_setting(...$args) { $GLOBALS['settings'][] = $args; }
function is_admin() { return $GLOBALS['admin']; }
function is_feed() { return $GLOBALS['feed']; }
function is_embed() { return $GLOBALS['embed']; }
function wp_enqueue_script(...$args) { $GLOBALS['scripts'][] = $args; }
function wp_enqueue_style(...$args) { $GLOBALS['styles'][] = $args; }
function current_user_can($cap) { return $cap === 'manage_options' && $GLOBALS['can_manage']; }
function wp_die($message, $title = '', $args = array()) { throw new RuntimeException('denied', $args['response'] ?? 0); }
function plugins_url($file, $plugin) { return 'https://shop.example/plugin/' . $file; }

require __DIR__ . '/../../integrations/wordpress/seller-desk-widget/seller-desk-widget.php';
$checks = 0;
function check($actual, $expected, $label) {
    global $checks;
    $checks++;
    if ($actual !== $expected) throw new RuntimeException('Failed: ' . $label);
}
foreach (array('https://desk.example' => 'https://desk.example', ' HTTPS://Desk.Example:443/ ' => 'https://desk.example', 'https://desk.example:8443' => 'https://desk.example:8443', '' => '') as $input => $expected) {
    check(SellerDesk\Widget\normalize_origin($input), $expected, 'valid origin');
}
foreach (array('javascript:alert(1)', '//desk.example', 'https://user:pass@desk.example', 'https://desk.example/buy', 'https://desk.example/../', 'https://desk.example?x=1', 'https://desk.example#x', 'https://desk.example\\@evil.example', 'https://desk.example%2f', "https://desk.example\n.evil.example", 'https://desk.example:0', 'https://desk.example:65536', 'https://-invalid.example', 'https://*.example', 'http://desk.example', 'http://localhost:4455', array('https://desk.example')) as $input) {
    check(SellerDesk\Widget\normalize_origin($input), null, 'unsafe origin');
}
$site = 'http://127.0.0.1:4457';
check(SellerDesk\Widget\normalize_origin('http://localhost:4455'), 'http://localhost:4455', 'local test origin');
check(SellerDesk\Widget\normalize_origin('http://[::1]:4455'), 'http://[::1]:4455', 'local ipv6');
check(SellerDesk\Widget\normalize_origin('http://192.168.1.1'), null, 'local site does not permit arbitrary HTTP');
$option = 'https://desk.example';
check(SellerDesk\Widget\sanitize_origin('https://evil.example/path'), $option, 'invalid edit preserves good value');
check(count($errors), 1, 'invalid edit produces visible error');
check(SellerDesk\Widget\sanitize_origin(''), '', 'blank disconnects');
SellerDesk\Widget\enqueue_widget();
check($scripts[0][1], 'https://desk.example/widget.js', 'fixed widget path');
check($scripts[0][4], array('strategy' => 'async', 'in_footer' => true), 'nonblocking footer');
foreach (array('admin', 'feed', 'embed') as $flag) {
    $scripts = array(); $GLOBALS[$flag] = true;
    SellerDesk\Widget\enqueue_widget();
    check(count($scripts), 0, 'frontend isolation'); $GLOBALS[$flag] = false;
}
foreach (array('', 'javascript:alert(1)', array('https://desk.example')) as $input) {
    $option = $input; $scripts = array(); SellerDesk\Widget\enqueue_widget();
    check(count($scripts), 0, 'unsafe stored setting never enqueues');
}
$scripts = array();
SellerDesk\Widget\enqueue_settings('settings_page_seller-desk-widget');
check(count($scripts), 0, 'unprivileged admin does not enqueue');
check(count($styles), 0, 'unprivileged styles isolation');
try { SellerDesk\Widget\settings_page(); throw new RuntimeException('page was not denied'); }
catch (RuntimeException $error) { check($error->getCode(), 403, 'page capability'); }
$can_manage = true;
SellerDesk\Widget\enqueue_settings('dashboard');
check(count($scripts), 0, 'unrelated admin page does not enqueue');
check(count($styles), 0, 'unrelated admin styles isolation');
SellerDesk\Widget\enqueue_settings('settings_page_seller-desk-widget');
check($scripts[0][1], 'https://shop.example/plugin/settings.js', 'admin script is local');
check($styles[0][1], 'https://shop.example/plugin/settings.css', 'local admin styles');
SellerDesk\Widget\register_settings();
check($settings[0][2]['show_in_rest'], false, 'setting not exposed in REST');
check($settings[0][2]['sanitize_callback'], 'SellerDesk\\Widget\\sanitize_origin', 'validation is registered');
echo json_encode(array('php' => PHP_VERSION, 'checks' => $checks, 'result' => 'passed')) . "\n";
