/// Exact static asset allowlist and MIME table matching `agent/onetop/server.py:965-977`.
pub const CSP_HEADER: &str = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'";

pub struct StaticAssetSpec {
    pub rel_path: &'static str,
    pub content_type: &'static str,
}

const TEXT_ASSETS: &[&str] = &[
    "/index.html",
    "/app.js",
    "/style.css",
    "/maps.js",
    "/ranges.js",
    "/speed.js",
    "/weekly.js",
    "/history.js",
    "/maps.css",
    "/typography.css",
    "/benchmark.json",
    "/dashboard.js",
    "/dashboard.css",
    "/i18n.js",
    "/effects.js",
    "/conversation.js",
    "/quick.html",
    "/quick.js",
    "/quick.css",
    "/cluster.js",
    "/cluster.css",
    "/cluster-pages.js",
    "/layout.js",
    "/customize.js",
    "/reports.js",
    "/cluster-themes.js",
    "/themes/core.js",
    "/themes/catalog.json",
    "/themes/mini.json",
    "/themes/pairs.js",
    "/themes/compact.js",
    "/themes/t01-06.js",
    "/themes/t07-17.js",
    "/themes/t18-28.js",
    "/themes/t29-39.js",
    "/themes/t40-50.js",
    "/themes/t51-61.js",
    "/themes/t62-72.js",
];

const FONT_ASSETS: &[&str] = &[
    "/fonts/ibm-plex/v1.0.0/IBMPlexSans.woff2",
    "/fonts/ibm-plex/v1.0.0/IBMPlexSansKR-Regular.woff2",
    "/fonts/ibm-plex/v1.0.0/IBMPlexSansKR-Medium.woff2",
    "/fonts/ibm-plex/v1.0.0/IBMPlexSansKR-SemiBold.woff2",
    "/fonts/ibm-plex/v1.0.0/IBMPlexSansKR-Bold.woff2",
];

pub fn resolve_static_asset(route: &str) -> Option<StaticAssetSpec> {
    if route == "/" {
        return Some(StaticAssetSpec {
            rel_path: "index.html",
            content_type: "text/html; charset=utf-8",
        });
    }
    if route == "/brand-mark_v1.1.0.png" {
        return Some(StaticAssetSpec {
            rel_path: "brand-mark_v1.1.0.png",
            content_type: "image/png",
        });
    }
    if let Some(&found) = FONT_ASSETS.iter().find(|&&p| p == route) {
        return Some(StaticAssetSpec {
            rel_path: &found[1..],
            content_type: "font/woff2",
        });
    }
    if let Some(&found) = TEXT_ASSETS.iter().find(|&&p| p == route) {
        let rel = &found[1..];
        let ext = rel.rsplit('.').next().unwrap_or("");
        let content_type = match ext {
            "html" => "text/html; charset=utf-8",
            "js" => "application/javascript; charset=utf-8",
            "css" => "text/css; charset=utf-8",
            "json" => "application/json; charset=utf-8",
            _ => return None,
        };
        return Some(StaticAssetSpec {
            rel_path: rel,
            content_type,
        });
    }
    None
}

pub fn all_static_routes() -> Vec<&'static str> {
    let mut routes = Vec::with_capacity(2 + TEXT_ASSETS.len() + FONT_ASSETS.len());
    routes.push("/");
    routes.extend_from_slice(TEXT_ASSETS);
    routes.push("/brand-mark_v1.1.0.png");
    routes.extend_from_slice(FONT_ASSETS);
    routes
}
