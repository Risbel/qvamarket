"use client";

import { useId, useRef, useState } from "react";
import { Autocomplete } from "@base-ui/react/autocomplete";
import { ImageIcon, Loader2Icon, SearchIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useDebouncedCallback } from "use-debounce";
import { PriceTag } from "@/components/price-tag";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Link, useRouter } from "@/i18n/navigation";
import {
  SEARCH_QUERY_MAX,
  SUGGEST_MIN_CHARS,
  searchTerms,
  type SearchSuggestResponse,
  type SearchSuggestion,
} from "@/lib/search";

/** Wait this long after the last keystroke before asking the server. */
const DEBOUNCE_MS = 300;
/** Answers kept in memory (per field): backspacing to an earlier query costs no request. */
const CACHE_SIZE = 20;
/** Same as the API's Cache-Control: prices and stock change, and so may the currency. */
const CACHE_TTL_MS = 30_000;

type Option = { kind: "product"; product: SearchSuggestion } | { kind: "all"; q: string };

const optionText = (option: Option) => (option.kind === "product" ? option.product.name : option.q);

/**
 * The storefront search field with suggestions while typing: a shadcn InputGroup (input +
 * submit button) driven by Base UI's Autocomplete, which provides the combobox semantics,
 * arrow-key navigation and the popup.
 *
 * Server load: one GET /api/store-search per pause in typing (debounced), the previous
 * request aborted when a new one starts, and recent answers reused from memory.
 * Enter on a highlighted suggestion opens it; Enter otherwise submits the form (the results
 * page). A GET form on purpose (the query belongs in the URL and holds nothing private), so
 * it also works before hydration.
 */
export function SearchAutocomplete({
  initialQuery,
  storeName,
  className,
}: {
  initialQuery: string;
  storeName: string;
  className?: string;
}) {
  const t = useTranslations("Store.search");
  const tc = useTranslations("Store.catalog");
  const locale = useLocale();
  const router = useRouter();
  const id = useId();
  const [value, setValue] = useState(initialQuery);
  const [result, setResult] = useState<{ q: string; data: SearchSuggestResponse } | null>(null);
  const [loading, setLoading] = useState(false);
  const cache = useRef(new Map<string, { at: number; data: SearchSuggestResponse }>());
  const inFlight = useRef<AbortController | null>(null);

  const fetchSuggestions = useDebouncedCallback(async (q: string) => {
    inFlight.current?.abort();
    inFlight.current = null;
    const key = searchTerms(q).join(" ");
    const cached = cache.current.get(key);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      setResult({ q, data: cached.data });
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    inFlight.current = controller;
    try {
      const response = await fetch(`/api/store-search?${new URLSearchParams({ q })}`, { signal: controller.signal });
      if (!response.ok) throw new Error(`store-search ${response.status}`);
      const data = (await response.json()) as SearchSuggestResponse;
      cache.current.delete(key);
      cache.current.set(key, { at: Date.now(), data });
      if (cache.current.size > CACHE_SIZE) cache.current.delete(cache.current.keys().next().value!);
      setResult({ q, data });
    } catch {
      // Aborted (a newer request took over) or failed (offline, rate limited): no suggestions,
      // the field still searches on Enter
      if (!controller.signal.aborted) setResult(null);
    } finally {
      if (inFlight.current === controller) {
        inFlight.current = null;
        setLoading(false);
      }
    }
  }, DEBOUNCE_MS);

  function stopSuggesting() {
    fetchSuggestions.cancel();
    inFlight.current?.abort();
    inFlight.current = null;
    setResult(null);
    setLoading(false);
  }

  const q = value.trim();
  const active = q.length >= SUGGEST_MIN_CHARS;
  const products = active ? (result?.data.items ?? []) : [];
  const options: Option[] =
    products.length > 0 ? [...products.map((product) => ({ kind: "product" as const, product })), { kind: "all", q }] : [];
  const noMatches = active && !loading && result !== null && result.data.items.length === 0;
  const status = loading && products.length === 0 ? "loading" : noMatches ? "empty" : null;

  return (
    <form
      role="search"
      method="get"
      action={`/${locale}/search`}
      className={className}
      onSubmit={(event) => {
        event.preventDefault();
        if (!q) return;
        stopSuggesting();
        (document.activeElement as HTMLElement | null)?.blur(); // closes the phone keyboard
        router.push({ pathname: "/search", query: { q } });
      }}
    >
      <Autocomplete.Root
        name="q"
        items={options}
        filter={null}
        value={value}
        itemToStringValue={optionText}
        openOnInputClick
        onValueChange={(next, details) => {
          setValue(next);
          if (details.reason === "item-press") return stopSuggesting(); // leaving for that page
          if (next.trim().length < SUGGEST_MIN_CHARS) return stopSuggesting();
          setLoading(true);
          fetchSuggestions(next.trim());
        }}
      >
        <label htmlFor={id} className="sr-only">
          {t("label")}
        </label>
        <Autocomplete.InputGroup
          render={
            // A light pill on the brand bar, readable whatever the brand color
            <InputGroup className="h-9 rounded-full border-transparent bg-background text-foreground shadow-sm has-[[data-slot=input-group-control]:focus-visible]:border-transparent has-[[data-slot=input-group-control]:focus-visible]:ring-(--brand-foreground)/50 dark:bg-background" />
          }
        >
          <Autocomplete.Input
            id={id}
            render={<InputGroupInput />}
            type="search"
            enterKeyHint="search"
            autoComplete="off"
            maxLength={SEARCH_QUERY_MAX}
            placeholder={t("placeholder", { store: storeName })}
            className="pl-4"
          />
          <InputGroupAddon align="inline-end">
            <InputGroupButton
              type="submit"
              aria-label={t("submit")}
              className="h-7 rounded-full px-2 hover:opacity-90 md:px-3"
              style={{ backgroundColor: "var(--brand)", color: "var(--brand-foreground)" }}
            >
              <SearchIcon aria-hidden />
              <span className="hidden md:inline">{t("submit")}</span>
            </InputGroupButton>
          </InputGroupAddon>
        </Autocomplete.InputGroup>

        <Autocomplete.Portal hidden={!active || (options.length === 0 && !status)}>
          {/* Above the store header (z-40) and its phone search row */}
          <Autocomplete.Positioner sideOffset={6} align="start" className="z-50 outline-none">
            <Autocomplete.Popup
              aria-busy={loading || undefined}
              className="max-h-[min(var(--available-height),26rem)] w-(--anchor-width) max-w-(--available-width) overflow-y-auto overscroll-contain rounded-xl border bg-popover p-1 text-popover-foreground shadow-lg"
            >
              <Autocomplete.Status>
                {status && (
                  <div className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground">
                    {status === "loading" ? (
                      <>
                        <Loader2Icon className="size-4 animate-spin" aria-hidden />
                        {t("loading")}
                      </>
                    ) : (
                      t("noSuggestions", { q: result?.q ?? q })
                    )}
                  </div>
                )}
              </Autocomplete.Status>
              <Autocomplete.List aria-label={t("suggestionsLabel")}>
                {(option: Option) =>
                  option.kind === "product" ? (
                    <Autocomplete.Item
                      key={option.product.slug}
                      value={option}
                      render={<Link href={`/products/${option.product.slug}`} />}
                      className="flex items-center gap-3 rounded-lg px-2 py-1.5 outline-none select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground"
                    >
                      {option.product.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element -- our own bucket, already compressed
                        <img
                          src={option.product.imageUrl}
                          alt=""
                          width={40}
                          height={40}
                          className="size-10 shrink-0 rounded-md border object-cover"
                        />
                      ) : (
                        <span className="flex size-10 shrink-0 items-center justify-center rounded-md border bg-muted text-muted-foreground">
                          <ImageIcon className="size-4" aria-hidden />
                        </span>
                      )}
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-sm font-medium">{option.product.name}</span>
                        <PriceTag
                          unitMinor={option.product.unitMinor}
                          compareAtMinor={option.product.compareAtMinor}
                          currency={result?.data.currency ?? ""}
                          locale={locale}
                          prefix={option.product.priceVaries ? tc("from") : undefined}
                          wasLabel={tc("was")}
                        />
                      </span>
                    </Autocomplete.Item>
                  ) : (
                    <Autocomplete.Item
                      key="_all"
                      value={option}
                      render={<Link href={{ pathname: "/search", query: { q: option.q } }} />}
                      className="mt-1 flex items-center gap-2 rounded-lg border-t px-3 py-2 text-sm font-medium outline-none select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground"
                    >
                      <SearchIcon className="size-4 shrink-0" aria-hidden />
                      <span className="truncate">{t("seeAllFor", { q: option.q })}</span>
                    </Autocomplete.Item>
                  )
                }
              </Autocomplete.List>
            </Autocomplete.Popup>
          </Autocomplete.Positioner>
        </Autocomplete.Portal>
      </Autocomplete.Root>
    </form>
  );
}
