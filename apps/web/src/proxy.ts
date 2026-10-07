import { NextResponse, type NextRequest } from "next/server";
import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";
import { getStoreSlug } from "./lib/tenancy";

const handleI18n = createMiddleware(routing);

const ROOT_DOMAIN = process.env.ROOT_DOMAIN ?? "localhost";

export default function proxy(request: NextRequest) {
  const slug = getStoreSlug(request.headers.get("host"), ROOT_DOMAIN);
  const response = handleI18n(request);

  // /[locale]/stores/[slug] is internal: only reachable through a store subdomain
  const [, , segment] = request.nextUrl.pathname.split("/");
  if (!slug) {
    return segment === "stores"
      ? new NextResponse(null, { status: 404 })
      : response;
  }

  // Locale redirects (e.g. / -> /es) are kept as they are
  if (response.headers.has("location")) return response;

  // <slug>.<root>/<locale>/<rest> -> /<locale>/stores/<slug>/<rest>
  const [, locale, ...rest] = request.nextUrl.pathname.split("/");
  const url = request.nextUrl.clone();
  url.pathname = `/${locale}/stores/${slug}${rest.length ? `/${rest.join("/")}` : ""}`;

  const rewrite = NextResponse.rewrite(url);
  // Keep next-intl's request headers and cookies, but not its own rewrite target
  response.headers.forEach((value, key) => {
    if (key !== "x-middleware-rewrite") rewrite.headers.set(key, value);
  });
  return rewrite;
}

export const config = {
  // Skip API routes, Next internals and static files
  matcher: "/((?!api|trpc|_next|_vercel|.*\\..*).*)",
};
